# THEPOOLsheets

Offline-Web-App fürs iPad: Leadsheets (PDF, Word .docx, Bilder) verwalten, Setlists bauen und auf der Bühne im Vollbild durchblättern.

## Auf GitHub Pages veröffentlichen

1. Auf github.com ein neues **öffentliches** Repository anlegen, z. B. `leadsheets`.
2. Im Repository auf **Add file → Upload files** gehen und den **Inhalt** dieses Ordners hochladen (nicht den Ordner selbst – `index.html` muss im Hauptverzeichnis liegen). Die versteckte Datei `.nojekyll` ist optional – falls sie beim Hochladen fehlt, ist das kein Problem.
3. **Settings → Pages**: unter „Build and deployment“ als Source **Deploy from a branch** wählen, Branch `main` und Ordner `/ (root)`, dann speichern.
4. Nach ein bis zwei Minuten ist die App unter `https://<dein-github-name>.github.io/leadsheets/` erreichbar.

## Aufs iPad bringen

1. Die Adresse in **Safari** öffnen.
2. **Teilen → Zum Home-Bildschirm**.
3. Die App ab jetzt nur noch über das Icon starten. Danach funktioniert sie komplett offline.

Wichtig: Die Leadsheets werden nur auf dem iPad gespeichert, nicht auf GitHub. Im Repository liegt nur der Programmcode. Unter ⚙︎ regelmäßig ein Backup exportieren (z. B. nach iCloud Drive).

## Bedienung auf der Bühne

- Rechts tippen oder nach links wischen: weiter (nächste Seite bzw. nächster Song)
- Links tippen oder nach rechts wischen: zurück
- Mitte tippen: Menü mit Liste, Ansicht (ganze Seite / Breite) und Nachtmodus
- Bluetooth-Fußpedale, die Pfeiltasten oder Bild auf/ab senden, funktionieren direkt.
- Solange die Bühnenansicht offen ist, bleibt das Display an.

## Updates

Nach jeder Code-Änderung in `sw.js` die Konstante `VERSION` erhöhen (z. B. `v2`). Dann lädt das iPad beim nächsten Start mit Internet die neue Version und meldet „Neue Version installiert“.
