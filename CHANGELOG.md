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

