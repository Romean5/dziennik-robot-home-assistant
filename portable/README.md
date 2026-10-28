# Dziennik Robót — wersja prywatna na własnym serwerze

Ten katalog opisuje plan i wymagania dla przenośnej wersji Dziennika Robót. Obecna publiczna wersja pozostaje bez zmian i nadal używa Cloudflare D1/R2.

## Założenia

- aplikacja webowa uruchamiana lokalnie na serwerze Home Assistant;
- wpisy, godziny, ustawienia i kolejka zadań przechowywane lokalnie na urządzeniu;
- serwer przechowuje wyłącznie zaszyfrowane kopie zapasowe;
- brak synchronizacji między telefonami w pierwszym etapie;
- gdy serwer jest niedostępny, kopia trafia do kolejki i jest ponawiana po odzyskaniu połączenia;
- sukces kopii jest pokazywany dopiero po potwierdzeniu zapisu na serwerze;
- poprzednie kopie są zachowywane, a przywracanie wybiera konkretną kopię.

## Zastąpienie Cloudflare D1/R2

Warstwa danych przenośnej wersji używa SQLite (rekordy i ustawienia) oraz katalogu plików na SSD (zdjęcia). `portable/cloudflare-loader.mjs` dostarcza lokalne bindingi zgodne z używanym API, ale nie łączy się z Cloudflare D1 ani R2. Kod aplikacji nie wymaga usług Cloudflare podczas działania kontenera.

Kopie zapasowe powinny mieć format ZIP zawierający `manifest.json`, bazę SQLite oraz zdjęcia. Archiwum musi być szyfrowane przed wysłaniem (np. AES-256-GCM), a klucz nie może być przechowywany w archiwum.

### Stan tego pakietu

Pakiet `v7` uruchamia aplikację produkcyjnym `vinext start` z natywnym lokalnym
SQLite/filesystem i jest gotowy do izolowanego testu na Home Assistant. Endpoint
administratora eksportu/importu oraz skrypt round-trip są zaimplementowane i
sprawdzają manifest, liczności, sumę oraz referencje. Nadal osobno trzeba dokończyć
interfejs lokalnego trybu offline z kolejką automatycznych kopii i szyfrowaniem
archiwów; przeglądarka nie wykona retry po zamknięciu bez ponownego otwarcia.
Nie importuj do tego pakietu jedynych kopii danych produkcyjnych przed testem na
kopii kontrolnej.

## Dane z obecnego hostingu

Nie należy usuwać ani wyłączać publicznej aplikacji. Migrację wykonuje się przez jednorazowy eksport uwierzytelnionych danych z D1/R2, kontrolę liczby wpisów i zdjęć, a następnie import do SQLite/filesystem. Przed importem trzeba wykonać kopię kontrolną i zachować oryginalne identyfikatory oraz daty.

## Web a przyszłe aplikacje mobilne

Wersja webowa może zapisać dane lokalnie i ponowić kopię przy następnym otwarciu, ale przeglądarka nie gwarantuje wykonywania zadań po zamknięciu. Automatyczne kopie w tle wymagają później aplikacji mobilnej albo systemowego mechanizmu serwera. APK/iOS nie są częścią tego etapu.

## Tłumaczenie lokalne wpisów (test)

Wpis zachowuje oryginalny tekst i język autora. W widoku „Wspólne wpisy” przycisk
może poprosić o tłumaczenie na angielski; wynik jest zapisywany w tabeli
`entry_translations` i używany ponownie. Na błąd lub brak modelu aplikacja
pozostawia tekst oryginalny. Wpisy „Tylko na tym telefonie” nie są wysyłane na
serwer i nie będą tłumaczone przez usługę HA.

W obrazie testowym `Dockerfile.portable` działa mały lokalny proces Argos Translate,
nasłuchujący wyłącznie na `127.0.0.1:8787`. Na etapie budowy obrazu pobierane są
modele Polish→English i Danish→English; w czasie działania treść wpisu nie jest
wysyłana do internetu ani do zewnętrznego API. Zmiana schematu jest dodatkowa i
nie nadpisuje wpisów: użytkownik dostaje `language`, wpis `source_language`, a
tłumaczenia trafiają do osobnej tabeli.

Obecny pakiet obsługuje źródła polski i duński; dla tekstu angielskiego tłumaczenie
nie jest potrzebne. Inne języki wymagają osobnego modelu oraz sprawdzenia, czy
Argos ma właściwą parę językową. To jest lokalny prototyp, nie potwierdzenie pracy
usługi na serwerze HA — przed wdrożeniem trzeba zbudować obraz na kopii danych,
sprawdzić obciążenie procesora i pamięci na Wyse i dopiero potem opublikować go
dotychczasowym workflow. Build wymaga internetu tylko do pobrania bibliotek i
modeli; właściwe tłumaczenie działa lokalnie.

## Test pierwszego etapu

1. Uruchomić lokalny serwer bez dostępu do Cloudflare.
2. Utworzyć użytkownika testowego i wpisać dane godzinowe oraz wpis z fotografią.
3. Zamknąć przeglądarkę, ponownie ją otworzyć i sprawdzić odczyt.
4. Wykonać eksport `/api/admin/backup`, sprawdzić manifest oraz zachować plik poza serwerem.
5. Wykonać import do izolowanej instancji i sprawdzić ponowny eksport (liczności + SHA).
6. Dopiero po tym zaplanować kolejkę kopii, szyfrowanie archiwów i przywracanie z UI.

## Uruchomienie przenośnego testu

W katalogu aplikacji znajduje się `Dockerfile.portable` oraz `docker-compose.portable.yml`. Ten etap uruchamia obecny interfejs i API lokalnie, bez połączenia z usługami Cloudflare. Trwały katalog `portable-data` (SQLite i `files/`) należy zamontować na SSD serwera i objąć kopią Home Assistant.

Polecenie startowe dla hosta z Docker Compose:

`docker compose -f docker-compose.portable.yml up -d --build`

Aplikacja będzie dostępna na porcie `3000`, a kontrola zdrowia pod `/api/health`. Kontener korzysta z natywnego SQLite i katalogu zdjęć w `portable-data`; Cloudflare D1/R2 nie są wymagane do działania.

## Dostęp przez Home Assistant / reverse proxy

Zmienne `DZIENNIK_ALLOWED_HOSTS` i parametr `--hostname 0.0.0.0` są ustawione tak,
aby aplikacja nasłuchiwała poza kontenerem, ale nie otwierała Vite na dowolny host.
W środowisku Home Assistant ustaw `DZIENNIK_ALLOWED_HOSTS` na dokładną nazwę hosta,
której używa ingress lub reverse proxy (lista rozdzielona przecinkami), na przykład
`dziennik-robot.local,192.168.1.50`. Nie używaj wartości `*`. Jeśli proxy przekazuje
`Host: 127.0.0.1:3000`, dodaj `127.0.0.1` do listy. HTTPS i uwierzytelnianie
pozostają po stronie Home Assistant/reverse proxy.

## Eksport i import danych

Po uruchomieniu instancji endpoint administratora `/api/admin/backup` tworzy
plik JSON z manifestem, sumą SHA-256, użytkownikami (z hashami PIN-ów), wpisami,
projektami oraz zdjęciami. POST do tego samego endpointu przyjmuje taki plik,
sprawdza format, liczności i sumę, a następnie wykonuje bezpieczny import z
zachowaniem identyfikatorów. Sesje logowania nie są przenoszone — po migracji
każdy użytkownik loguje się ponownie. Endpoint wymaga aktywnego administratora
i zgodnego `teamId`; nie jest publicznym uploadem.

Skrypt `portable/backup-roundtrip.mjs` automatyzuje eksport i opcjonalny import:

```text
DR_ADMIN_NAME=admin DR_ADMIN_PIN=1234 \
DR_SOURCE_URL=http://127.0.0.1:3000 \
DR_TARGET_URL=http://127.0.0.1:3001 \
DR_BACKUP_FILE=backup.json \
node portable/backup-roundtrip.mjs
```

Najpierw uruchom go tylko z `DR_SOURCE_URL`, otwórz i zachowaj plik w bezpiecznym
miejscu, sprawdź manifest i dopiero potem wykonaj import do izolowanej instancji.
Nie nadpisuje ani nie usuwa danych źródłowych. Plik zawiera dane uwierzytelniające
i zdjęcia, więc po potwierdzeniu transferu przenieś go szyfrowanym kanałem i usuń
kopię roboczą.
