# Learning Cards (beugró + tétel)

Egyszerű, mobile-first, Anki/Quizlet-szerű webapp a kérdések gyakorlásához.

## Mit tud?

- Kezdéskor választás: **beugró** vagy **tétel** kérdések
- Kártya **megfordítása** (tap / kattintás / Enter)
- Megfordítás után értékelés: **Nem tudtam / Részben / Tudtam**
- Egyszerű ismétlési logika: a kevésbé ismert kártyák **gyakrabban** jönnek elő
- A válasz alatt megjelenik megjegyzésként a **forrás**: PDF név + oldalszám(ok)
- Haladás mentése böngészőben (`localStorage`), külön deckenként

## Indítás

A JSON betöltéséhez a legegyszerűbb egy helyi szerver (különben a böngésző néha blokkolhatja).

PowerShell (Windows):

```powershell
cd c:\Suli\season5\db\vizsga\learningcards
python -m http.server 5173
```

Nyisd meg:

- http://localhost:5173

## GitHub Pages

Ha a repót GitHub Pages-en publikálod (forrás: repo root), akkor a kvíz jellemzően ezen az útvonalon érhető el:

- `https://<felhasznalo>.github.io/<repo>/learningcards/`

## Adatforrások

- `./adatb_beugro_qa_all.json`
- `./adatb_tetelek_qa_all.json`
