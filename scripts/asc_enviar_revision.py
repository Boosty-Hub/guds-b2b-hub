"""Envía una versión de iOS a revisión de App Store por la API de App Store Connect.

Lo corre .github/workflows/ios-submit-review.yml con los secretos ASC_* del repositorio.

  modo=estado  solo lee: la app, el build pedido y las versiones de la ficha (no cambia nada)
  modo=enviar  deja la versión en App Store Connect con ese build y sus notas, y la manda a revisión

Si ya hay una versión editable (PREPARE_FOR_SUBMISSION, DEVELOPER_REJECTED, REJECTED...) se reusa y se le cambia
el número; Apple no deja tener dos versiones abiertas a la vez.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

import jwt  # pyjwt[crypto]

API = "https://api.appstoreconnect.apple.com/v1"
EDITABLES = {
    "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED",
    "INVALID_BINARY", "WAITING_FOR_REVIEW_CANCELLED",
}


def token():
    clave = base64.b64decode(os.environ["ASC_API_KEY_P8"]).decode()
    ahora = int(time.time())
    return jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"], "iat": ahora, "exp": ahora + 1100, "aud": "appstoreconnect-v1"},
        clave, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"},
    )


TOKEN = token()


def pedir(metodo, ruta, cuerpo=None):
    url = ruta if ruta.startswith("http") else API + ruta
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo, headers={
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            texto = r.read().decode()
            return json.loads(texto) if texto else {}
    except urllib.error.HTTPError as e:
        print(f"::error::{metodo} {ruta} → {e.code}: {e.read().decode()[:1500]}")
        sys.exit(1)


def main():
    modo = os.environ.get("MODO", "estado")
    bundle = os.environ["BUNDLE_ID"]
    version = os.environ["VERSION"]
    build_num = os.environ["BUILD"]
    notas = os.environ.get("NOTAS", "").strip()

    app = pedir("GET", f"/apps?filter[bundleId]={bundle}")["data"][0]
    app_id = app["id"]
    print(f"App: {app['attributes']['name']} ({bundle}) id={app_id}")

    builds = pedir("GET", f"/builds?filter[app]={app_id}&filter[version]={build_num}"
                          f"&filter[preReleaseVersion.version]={version}&limit=5")["data"]
    if not builds:
        print(f"::error::No aparece el build {version} ({build_num}) en App Store Connect")
        sys.exit(1)
    build = builds[0]
    ba = build["attributes"]
    print(f"Build {version} ({build_num}): estado={ba.get('processingState')} cifrado={ba.get('usesNonExemptEncryption')}")

    versiones = pedir("GET", f"/apps/{app_id}/appStoreVersions?filter[platform]=IOS&limit=10")["data"]
    for v in versiones:
        print(f"  versión {v['attributes']['versionString']}: {v['attributes']['appStoreState']}")

    if modo != "enviar":
        print("Modo estado: no se cambió nada.")
        return

    if ba.get("processingState") != "VALID":
        print("::error::El build todavía no está procesado (VALID); probar en unos minutos.")
        sys.exit(1)
    if ba.get("usesNonExemptEncryption") is None:
        pedir("PATCH", f"/builds/{build['id']}", {"data": {"type": "builds", "id": build["id"],
              "attributes": {"usesNonExemptEncryption": False}}})
        print("Cumplimiento de exportación: sin cifrado no exento.")

    destino = next((v for v in versiones if v["attributes"]["versionString"] == version), None)
    if destino is None:
        destino = next((v for v in versiones if v["attributes"]["appStoreState"] in EDITABLES), None)
        if destino is not None:
            pedir("PATCH", f"/appStoreVersions/{destino['id']}", {"data": {"type": "appStoreVersions",
                  "id": destino["id"], "attributes": {"versionString": version}}})
            print(f"Versión editable {destino['attributes']['versionString']} pasa a {version}.")
        else:
            destino = pedir("POST", "/appStoreVersions", {"data": {"type": "appStoreVersions",
                "attributes": {"platform": "IOS", "versionString": version},
                "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})["data"]
            print(f"Versión {version} creada.")
    vid = destino["id"]

    pedir("PATCH", f"/appStoreVersions/{vid}/relationships/build", {"data": {"type": "builds", "id": build["id"]}})
    print(f"Build {build_num} asignado a la versión {version}.")

    if notas:
        locs = pedir("GET", f"/appStoreVersions/{vid}/appStoreVersionLocalizations")["data"]
        for loc in locs:
            pedir("PATCH", f"/appStoreVersionLocalizations/{loc['id']}", {"data": {
                "type": "appStoreVersionLocalizations", "id": loc["id"], "attributes": {"whatsNew": notas}}})
            print(f"Notas de la versión ({loc['attributes']['locale']}).")

    # Un envío abierto sin mandar se reusa; si no, se crea
    abiertos = pedir("GET", f"/reviewSubmissions?filter[app]={app_id}&filter[platform]=IOS"
                            f"&filter[state]=READY_FOR_REVIEW&limit=5")["data"]
    envio = abiertos[0] if abiertos else pedir("POST", "/reviewSubmissions", {"data": {"type": "reviewSubmissions",
        "attributes": {"platform": "IOS"}, "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})["data"]
    items = pedir("GET", f"/reviewSubmissions/{envio['id']}/items")["data"]
    if not items:
        pedir("POST", "/reviewSubmissionItems", {"data": {"type": "reviewSubmissionItems", "relationships": {
            "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": envio["id"]}},
            "appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})
    pedir("PATCH", f"/reviewSubmissions/{envio['id']}", {"data": {"type": "reviewSubmissions", "id": envio["id"],
          "attributes": {"submitted": True}}})
    final = pedir("GET", f"/appStoreVersions/{vid}")["data"]["attributes"]["appStoreState"]
    print(f"Enviado a revisión. Estado de la versión {version}: {final}")


if __name__ == "__main__":
    main()
