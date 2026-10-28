# Instrukcja dla zadania „Home Assistant”

Serwer docelowy: Dell Wyse 5070, Pentium J5005, 8 GB RAM, SSD 256 GB, Home Assistant OS.

## Wymagania

- stały adres IP lub rezerwacja DHCP;
- osobny katalog na SSD na bazę, zdjęcia i kopie;
- bezpieczny dostęp HTTPS (np. istniejący reverse proxy/Home Assistant ingress);
- kopie zapasowe samego katalogu danych poza serwerem; klucz szyfrowania (gdy włączymy archiwa szyfrowane) przechowywać osobno;
- ograniczenie dostępu do aplikacji hasłem/PIN-em i brak publicznego wystawienia portu bez HTTPS.

## Zalecany sposób wdrożenia

Przygotować dodatek Home Assistant lub kontener kompatybilny z Home Assistant OS, który uruchamia portable build Dziennika Robót. Aplikacja powinna przyjmować ścieżkę danych jako konfigurację, nie zapisywać danych w obrazie kontenera i udostępniać tylko HTTP wewnątrz sieci; HTTPS i dostęp zdalny pozostawić warstwie Home Assistant/reverse proxy.

Kontener uruchamia serwer na `0.0.0.0` przez `--hostname`, więc ingress może się z
nim połączyć. W konfiguracji dodatku ustaw `DZIENNIK_ALLOWED_HOSTS` jako jawną,
przecinkową listę zaufanych nazw hostów (dokładna nazwa ingress/reverse proxy oraz
ewentualnie `127.0.0.1`). Nie ustawiaj wildcardu `*`; lista ogranicza ochronę Vite
przed nieznanym nagłówkiem Host.

## Kopie i przywracanie

Dodatek powinien montować trwały katalog `/data/dziennik-robot`, wykonywać rotowane kopie
katalogu i umożliwiać wskazanie kopii do przywrócenia. Nie usuwać kopii automatycznie
bez polityki retencji. Przed pierwszym importem zachować eksport z obecnego hostingu
jako kopię tylko do odczytu. Obecny endpoint `/api/admin/backup` przenosi dane w
JSON-ie z manifestem/SHA; szyfrowane ZIP-y i harmonogram rotacji są kolejnym etapem,
nie należy udawać, że są już aktywne.

To zadanie dotyczy wyłącznie konfiguracji serwera. Kod i adapter portable są przygotowywane w zadaniu Dziennika Robót.
