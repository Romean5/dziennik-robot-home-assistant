"""Install only the Polish→English and Danish→English Argos models at image build."""

import argostranslate.package
import argostranslate.translate

argostranslate.package.update_package_index()
available = argostranslate.package.get_available_packages()
required = {"pl": "1.9", "da": "1.9"}
for source, version in required.items():
    package = next((item for item in available if item.from_code == source and item.to_code == "en" and item.package_version == version), None)
    if package is None:
        raise SystemExit(f"No official Argos model found for {source} -> en")
    argostranslate.package.install_from_path(package.download())

installed = {language.code for language in argostranslate.translate.get_installed_languages()}
if not {"pl", "da", "en"}.issubset(installed):
    raise SystemExit("Required Polish/Danish-to-English models did not install")
