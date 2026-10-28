# Dziennik Robót — Home Assistant

Repozytorium zawiera kod aplikacji i definicję obrazu Home Assistant. Nie zależy od konfiguracji poprzedniego hostingu.

Nie zawiera danych użytkowników, zdjęć, baz SQLite, sesji, PIN-ów ani kopii zapasowych. Trwałe dane aplikacji są przechowywane przez Home Assistant w `/data/native`.

## Aktualizacje

Każdy nowy numer w `config.yaml` jest budowany w GitHub Actions jako obraz GHCR dla `amd64`. Home Assistant porównuje wersję z `config.yaml` i pobiera gotowy obraz po wybraniu aktualizacji.

## Ważne przy migracji

Istniejąca lokalna aplikacja `local_dziennik_robot_test` zachowuje własne dane. Instalacja aplikacji z tego repozytorium jest nową tożsamością Home Assistant, dlatego migrację danych należy wykonać jako oddzielny, sprawdzony krok z kopią zapasową — nigdy przez usunięcie działającej aplikacji.
