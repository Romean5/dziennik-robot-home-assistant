# Dziennik Robót

Użytkownik otwiera publiczny adres aplikacji i podaje wyłącznie swoje imię/login oraz PIN. Nowy profil czeka na zatwierdzenie administratora zespołu. Nie potrzeba nazwy bazy ani wspólnego hasła serwera.

Baza SQLite i zdjęcia pozostają w prywatnym katalogu /data/native dodatku. Nie są publikowane jako pliki WWW. Dostęp do wpisów i zdjęć wymaga sesji aplikacji, a funkcje administracyjne wymagają roli administratora.

Administrator może wygenerować tymczasowy PIN dla członka zespołu po sprawdzeniu jego tożsamości. Kod należy przekazać tej osobie prywatnie. Stare sesje są unieważniane, a użytkownik musi ustawić własny PIN przed dostępem do danych.

Przed aktualizacją wykonaj kopię dodatku w Home Assistant. Przywracanie pełnej kopii cofa dane do momentu jej utworzenia, dlatego nie używaj go do zwykłego restartowania aplikacji.
