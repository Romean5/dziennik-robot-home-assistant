# 0.2.18

- Podgląd PDF jest renderowany bezpośrednio w aplikacji przez PDF.js, bez otwierania automatycznej karty `blob:`. Działa także na telefonach, które blokują własny podgląd PDF.
- „Pobierz PDF” prowadzi teraz do widocznego przycisku pobierania w podglądzie. Dzięki temu Android nie blokuje syntetycznego pobrania uruchamianego po wygenerowaniu pliku.

# 0.2.17

- Każdy nowy wpis godzin ma trwale zapisany wybrany tydzień raportowy. Można wpisać datę z niedzieli albo nawet z wcześniejszego miesiąca, a wpis pozostanie w tygodniu wybranym podczas zapisu. Zmiana daty lub przejście do innego tygodnia nie przenosi poprzednich wpisów.
- Przy zapisie godzin aplikacja wyraźnie pokazuje tydzień docelowy.

# 0.2.16

- Główny administrator może nadać wybranemu użytkownikowi rolę „Administrator brygady” albo ją odebrać. Administrator brygady może zatwierdzać nowych użytkowników i resetować PIN-y zwykłych członków, ale nie może nadawać ról ani ingerować w głównego administratora.

# 0.2.15

- Przycisk instalacji uruchamia teraz systemowe okno instalacji, gdy przeglądarka je udostępnia; w przeciwnym razie nazywa się jasno „Jak zainstalować”. Dodano wymagane przez Androida ikony PNG 192×192 i 512×512.

# 0.2.14

- Konto z rolą administratora jest automatycznie aktywowane przy logowaniu, także w przypadku starszego błędnego wpisu ze statusem „oczekuje”. Zwykli nowi użytkownicy nadal wymagają zatwierdzenia administratora.

# 0.2.13

- Nowy ekran startowy z kafelkami: Karta pracy, Raport tygodniowy, Dzisiejszy wpis, Wspólne wpisy, Ustawienia oraz Użytkownicy zespołu dla administratora.
- Po wybraniu kafelka widoczna jest tylko jego sekcja; przycisk powrotu prowadzi do kafelków.

# 0.2.12

- Ewidencja godzin zawiera tylko datę, godziny, kilometry i budowę / ulicę.
- Klient / firma dla wpisu godzinowego jest pobierany automatycznie ze stałych danych wybranego górnego albo dolnego raportu.

# 0.2.11

- W stałych danych najpierw widoczna jest duńska nazwa kratki z oryginalnego blankietu, a obok tłumaczenie w wybranym języku aplikacji.

# 0.2.10

- Pola stałych danych raportu pokazują teraz nazwę angielską oraz tłumaczenie w wybranym języku, aby łatwiej dopasować je do blankietu.
- Usunięto z interfejsu administratora sekcję „Bezpieczne przenoszenie danych”.

# 0.2.7

- Bezpieczne przeniesienie danych między starą i nową instalacją: eksport oraz import działający wyłącznie do świeżej, pustej instalacji.
- Stara instalacja pozostaje bez zmian, a po imporcie logujesz się dotychczasowym PIN-em.

# 0.2.6

- Manifest dodatku w osobnym katalogu, aby Home Assistant wykrywał aktualizacje z tego repozytorium.
- Obraz `ghcr.io/romean5/dziennik-robot-home-assistant:0.2.6` dla `amd64`.

# 0.2.5

- Pierwsze wydanie obrazu dla Home Assistant.
- Aplikacja używa lokalnej bazy i plików z `/data/native`.
- Aktualizacja kodu nie usuwa wpisów ani zdjęć z danych aplikacji.

