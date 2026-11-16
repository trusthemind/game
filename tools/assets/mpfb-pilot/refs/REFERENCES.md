# Референс-борд: обличчя та тіла (жінки / чоловіки)

Дата збору: 2026-11-15. Крок 1 з 3 (збір). Тут лише ПОСИЛАННЯ й нотатки; жодних файлів не завантажено.
Мета: використати як референс структури й пропорцій для MPFB2-пайплайну, а не копіювати чиюсь подобу.

## Правила використання (важливо)

- Фото/скани реальних людей = лише референс пропорцій і структури (кістки, співвідношення, форма). Не переносити
  впізнавану подобу. Фінальні обличчя мають бути оригінальними комбінаціями рис.
- Репозиторій публічний: у git НЕ класти ні фото, ні скани звідси. Локально тримати в `~/.cache/ashfall-src/refs/`
  (поза репо). У REFERENCES.md лишаються тільки посилання.
- Ліцензії перевірені за сторінками/API на 2026-11-15; перед будь-яким завантаженням ще раз глянути ліцензію на
  сторінці файлу. Завантаження — лише після окремого погодження користувача (ім'я файлу, джерело, розмір).
- ВАЖЛИВО про те, як це зібрано: описи фото з Pexels/Commons нижче взяті з підписів і списків сторінок, самі
  зображення я не розглядав покадрово. Перед використанням відкрити, переконатися в куті/нейтральності, відсіяти.
- Pexels: безкоштовно, комерційно можна, атрибуція не обов'язкова, але "впізнавані люди не мають показуватися в
  поганому світлі" (https://www.pexels.com/license/). Unsplash: безкоштовно, без атрибуції, про образ людини нічого
  не сказано (https://unsplash.com/license). Це не CC0, тому для референсу ок, для вшивання в гру не брати.

---

## 1. Обличчя: жінки

| # | Посилання | Ліцензія | Що показує | Навіщо |
|---|-----------|----------|------------|--------|
| W-F1 | [Face Research Lab London Set](https://figshare.com/articles/dataset/Face_Research_Lab_London_Set/5047666) (DOI 10.6084/m9.figshare.5047666) | CC BY 4.0, суб'єкти дали згоду на дослідницьке й ілюстративне використання | 102 дорослі (чоловіки й жінки), 1350x1350, нейтральні: фронт, 3/4 і профіль ліворуч/праворуч, плюс усміхнені; є вік/стать/етнічність у `london_faces_info.csv` і розмітка 189 точок обличчя | Найкращий наявний набір: однакове світло, нейтральне обличчя, усі три ракурси. 189 точок дають готові виміри (ширина обличчя, відстань між очима, ширина носа/рота, щелепа). Розміри: neutral_front 33.9 MB; neutral_left_3quarter 24.2 MB; neutral_left_profile 25.5 MB; (right-аналоги 24.3 / 25.8 MB). Оптимум: front + left_3quarter + left_profile = ~84 MB |
| W-F2 | [Commons: Profile views of females](https://commons.wikimedia.org/wiki/Category:Profile_views_of_females) | змішано (PD / CC BY / CC BY-SA, дивитися кожен файл) | 12 підкатегорій: вліво (138 ф.), вправо (190), 3/4 (224), "Women facing left" (1290), "Women facing right" (1132) | Профілі різного віку/походження; лоб-ніс-підборіддя, лінія щелепи, шия |
| W-F3 | [Commons: Three-quarter views of females](https://commons.wikimedia.org/wiki/Category:Three-quarter_views_of_females) | змішано, дивитися файл | 224 файли + "Three-quarter views of women" (135 ф.) | 3/4: вилиці, перенісся, глибина очниць. Категорія містить і картини, брати лише фото |
| W-F4 | [Pexels: профіль, жінка, чорне волосся (cottonbro)](https://www.pexels.com/photo/woman-with-black-hair-10209450/) | Pexels licence | Чистий профіль, однотонний фон | Профіль носа/губ/підборіддя |
| W-F5 | [Pexels: вид збоку, довге волосся (cottonbro)](https://www.pexels.com/photo/a-side-view-of-a-woman-s-face-6153071/) | Pexels licence | Крупний профіль | Лінія щелепи-шиї |
| W-F6 | [Pexels: впевнена африканська жінка](https://www.pexels.com/photo/elegant-portrait-of-a-confident-african-woman-33170459/) | Pexels licence | Крупний план, фронт | Структура обличчя темної шкіри (широкі вилиці, повні губи, ніс) |
| W-F7 | [Pexels: портрет у студії (enginakyurt)](https://www.pexels.com/photo/women-s-white-tpo-1438795/) | Pexels licence | Студійний фронт, виразна міміка | Брови, форма очей |
| W-F8 | [Pexels: ч/б афро-зачіска (rdne)](https://www.pexels.com/photo/grayscale-photo-of-an-afro-haired-woman-looking-at-camera-while-posing-7148581/) | Pexels licence | Ч/б, фронт, спокійний вираз | Чиста форма без кольору |
| W-F9 | [Pexels: студійний портрет, чорна водолазка (spencphoto)](https://www.pexels.com/photo/elegant-studio-portrait-of-a-woman-in-black-turtleneck-36646353/) | Pexels licence | Класичний студійний портрет | Пропорції голова-шия-плечі |
| W-F10 | [Pexels: профіль, червона куртка (daigofotos)](https://www.pexels.com/photo/thoughtful-portrait-of-a-woman-in-red-jacket-32593794/) | Pexels licence | Профіль, шия й плечі | Шия до трапеції |

Примітка: Pexels-сторінки знайдено через пошук по сайту; спершу відкрити й переконатися, що кадр нейтральний.

## 2. Обличчя: чоловіки

| # | Посилання | Ліцензія | Що показує | Навіщо |
|---|-----------|----------|------------|--------|
| M-F1 | [Face Research Lab London Set](https://figshare.com/articles/dataset/Face_Research_Lab_London_Set/5047666) | CC BY 4.0 | те саме, чоловіча частина (фільтр у `london_faces_info.csv`) | Чоловічі фронт/3/4/профіль в однаковому світлі |
| M-F2 | [Commons: Profile views of males](https://commons.wikimedia.org/wiki/Category:Profile_views_of_males) | змішано, дивитися файл | вліво 143 ф., вправо 105, 3/4 47 ф. | Профілі: брова, ніс, щелепа, шия |
| M-F3 | [Pexels: ч/б профіль молодого чоловіка (juanpphotoandvideo)](https://www.pexels.com/photo/grayscale-photography-of-man-1161267/) | Pexels licence | ч/б профіль | Чиста лінія профілю |
| M-F4 | [Pexels: профіль, шкіряна куртка](https://www.pexels.com/photo/side-profile-portrait-of-man-in-leather-jacket-37105842/) | Pexels licence | профіль, темний фон | Щелепа й шия видно добре |
| M-F5 | [Pexels: чоловік у білій футболці боком (sebastiaan9977)](https://www.pexels.com/photo/photo-of-man-in-white-t-shirt-facing-sideways-1304643/) | Pexels licence | профіль + плечі | Профіль голова-шия-плечі |
| M-F6 | [Pexels: студійний портрет, сивий чоловік (Ron Lach)](https://www.pexels.com/photo/studio-portrait-of-man-with-gray-hair-9832468/) | Pexels licence | фронт, старший вік | Зморшки, зріла структура, для NPC/скавів |
| M-F7 | [Pexels: чоловік у чорному (Sunpreet Singh Dhanjal)](https://www.pexels.com/photo/man-wearing-black-long-sleeved-shirt-2848033/) | Pexels licence | фронт, природне світло | Брови-ніс-щелепа |
| M-F8 | [Pexels: бородатий чоловік (Amirali Shaghaghi)](https://www.pexels.com/photo/portrait-of-brunette-man-17653059/) | Pexels licence | фронт, борода | Маска борідної зони |
| M-F9 | [Pexels: ч/б чоловік, крупний план (Brandon Athey)](https://www.pexels.com/photo/grayscale-portrait-of-a-man-14997036/) | Pexels licence | ч/б фронт | Форма без кольору |
| M-F10 | [Pexels: чоловік у чорній водолазці, борода (Angelica Reyn)](https://www.pexels.com/photo/a-close-up-shot-of-a-man-in-black-turtleneck-sweater-11805721/) | Pexels licence | фронт, борода | Щелепа під бородою |

Подальші джерела для різноманіття (перевірити ліцензію в момент вибору): Commons "Category:Official portraits"
офіційні портрети військових/астронавтів США (державні роботи, часто public domain; нейтральний фронт, різні
етнічності й віки). Брати як анонімну структуру, не як "людину".

## 3. Тіла: жінки (повний зріст)

| # | Посилання | Ліцензія | Що показує | Навіщо |
|---|-----------|----------|------------|--------|
| W-B1 | [Commons: 21st-century portraits of standing women at full length](https://commons.wikimedia.org/wiki/Category:21st-century_portrait_photographs_of_standing_women_at_full_length) | змішано, дивитися файл | 250 файлів, повний зріст, стоячи (є й не-нейтральні пози) | Пропорції вдягнених, різні типи фігур |
| W-B2 | [Commons: Portrait photographs of standing women at full length](https://commons.wikimedia.org/wiki/Category:Portrait_photographs_of_standing_women_at_full_length) | змішано | батьківська категорія, є 20-го ст. і ч/б | Старші фото й форма одягу |
| W-B3 | [Pexels: струнка спортсменка, фронт (karola-g)](https://www.pexels.com/photo/slim-sportswoman-with-folded-yoga-mat-at-home-4498516/) | Pexels licence | фронт, повний зріст, спортивний одяг | Пропорції ніг/тулуба, середня фігура |
| W-B4 | [Pexels: активна жінка в яскравому одязі (andrea-musto)](https://www.pexels.com/photo/active-woman-in-colorful-fitness-attire-posing-30246174/) | Pexels licence | фронт, нейтральний фон | Плечі/талія/стегна |
| W-B5 | [Pexels: топ і легінси, студія (wesleydavi)](https://www.pexels.com/photo/young-woman-in-a-crop-top-and-tight-leggings-16122053/) | Pexels licence | студія, облягаючий одяг, повний зріст | Лінія стегон, ноги, живіт |
| W-B6 | [Pexels: спортивний одяг, білий фон (wesleydavi)](https://www.pexels.com/photo/woman-posing-in-sports-clothing-16122061/) | Pexels licence | атлетична, білий фон | Атлетична жінка, м'язи ніг |
| W-B7 | [Pexels: профіль на одній нозі (bamboo-ave)](https://www.pexels.com/photo/model-in-gray-sportswear-posing-on-one-leg-17917167/) | Pexels licence | вид збоку, повний зріст | Бічний профіль: груди, сідниці, вигин попереку |
| W-B8 | [Pexels: стійка-шпагат, фронт (marta-wave)](https://www.pexels.com/photo/fit-female-doing-standing-split-in-studio-6453564/) | Pexels licence | повний зріст, ноги видно повністю | Довжина й форма ніг (поза не нейтральна) |

Бракує: вид ззаду й нейтральна T/A-поза. Шукати окремо ("back view standing woman fitted clothing", Pexels/Commons).

## 4. Тіла: чоловіки (повний зріст)

| # | Посилання | Ліцензія | Що показує | Навіщо |
|---|-----------|----------|------------|--------|
| M-B1 | [Commons: 21st-century portraits of standing men at full length](https://commons.wikimedia.org/wiki/Category:21st-century_portrait_photographs_of_standing_men_at_full_length) | змішано | 248 файлів, повний зріст | Пропорції вдягнених чоловіків, різні типи |
| M-B2 | [Commons: ... in military uniforms](https://commons.wikimedia.org/wiki/Category:21st-century_portrait_photographs_of_standing_men_at_full_length_in_military_uniforms) | змішано | 7 файлів | Поставу й плечі в формі, близько до нашої гри |
| M-B3 | [Pexels: атлетичний чоловік, білий фон (infectedmarket)](https://www.pexels.com/photo/athletic-man-posing-in-gym-wear-28758302/) | Pexels licence | шорти й майка, нейтральний фон | Атлетична середня фігура, плечі/ноги |
| M-B4 | [Pexels: без футболки, шорти, сірий фон (rocketmann-prod)](https://www.pexels.com/photo/shirtless-man-in-black-shorts-posing-9486824/) | Pexels licence | торс, ноги, студія | Мускулатура грудей, пресу, ніг |
| M-B5 | [Pexels: чоловік у білій сорочці, білий фон (vazhnik)](https://www.pexels.com/photo/man-wearing-white-shirt-on-white-background-7561443/) | Pexels licence | повний зріст, нейтральна стійка | Пропорції "звичайної" людини |
| M-B6 | [Pexels: чорношкірий чоловік у спортивному костюмі, повний зріст (shvets-production)](https://www.pexels.com/photo/black-man-wearing-tracksuit-standing-with-hand-on-head-6974949/) | Pexels licence | студія, повний зріст | Інша комплекція й пропорції ніг |
| M-B7 | [Pexels: чоловік у спортзалі (cottonbro)](https://www.pexels.com/photo/man-in-activewear-standing-inside-the-gym-7671466/) | Pexels licence | м'язистий, стоїть | Ширина плечей/рук |
| M-B8 | [Pexels: літній чоловік, активний одяг (shvetsa)](https://www.pexels.com/photo/elderly-man-in-blue-activewear-standing-on-yellow-background-6250986/) | Pexels licence | літній, повний зріст | Постава, зріла комплекція для NPC |

Не брати як цільове: [muscled man on black (mike-jones)](https://www.pexels.com/photo/muscled-man-posing-on-black-background-8874919/) (бодібілдинг, нереалістично для "виживальника"; лише для крайнього "muscular").

## 5. 3D (Sketchfab, лише CC BY / CC0, зі сторінок API)

Як працює `tools/assets/sketchfab.mjs`: читає `tools/assets/sketchfab.json` (`{uid, slug, use}`), для кожної моделі
запитує `api.sketchfab.com/v3/models/<uid>`, пропускає все, чия ліцензія не `CC0` / `CC Attribution` (регекс
`^(CC0|CC Attribution)$`), качає glTF-архів (потрібен токен із `~/.sketchfab_token` або `SKETCHFAB_TOKEN`),
розпаковує в `$ASSET_SRC/sketchfab/<slug>/` і дописує рядок атрибуції в `sketchfab-credits.txt`. Я його НЕ запускав.
Щоб додати модель: дописати запис у `sketchfab.json` і запустити `ASSET_SRC=… node tools/assets/sketchfab.mjs <slug>` (після
вашого погодження завантаження).

Знахідка: у пошуку CC0 з "human/head/body scan" нічого релевантного немає (4 результати - статуї/предмети від музеїв).
Усе придатне - CC BY (потрібна атрибуція, її вже веде `sketchfab-credits.txt`).

| # | Модель | Ліцензія | Полігони (tris/faces) | Ріг | Що показує / навіщо |
|---|--------|----------|-----------------------|-----|---------------------|
| 3D-1 | [Generic Man (Scanlab)](https://sketchfab.com/3d-models/generic-man-9b4527d4bc524c31bed48054f0c04b71) uid 9b4527d4bc524c31bed48054f0c04b71 | CC BY 4.0 | 35 192 f / 17 746 v, 12 текстур | ні (0 анімацій) | Усереднений чоловік із ~50 сканів, ТІЛО З ГОЛОВОЮ. Найкращий референс пропорцій чоловічого тіла (плечі/ноги/торс); текстури нерівні |
| 3D-2 | [Generic Woman (Scanlab)](https://sketchfab.com/3d-models/generic-woman-ff5571cf3b484f4385c305e0cd70ad21) uid ff5571cf3b484f4385c305e0cd70ad21 | CC BY | 35 192 f / 17 746 v | ні | Те саме для жінки |
| 3D-3 | [Head (Lee Perry Smith)](https://sketchfab.com/3d-models/head-lee-perry-smith-4d07eb2030db4406bc7eee971d1d3a97) uid 4d07eb2030db4406bc7eee971d1d3a97 | CC BY (атрибуція: Lee Perry-Smith та Triplegangers) | 8 842 f | ні | Класичний чоловічий скан голови; ідеальна низька топологія, добре бачити форму черепа, брови, ніс. Реальна людина: лише структура |
| 3D-4 | [Michal 3D - photoscanned human face](https://sketchfab.com/3d-models/micha-3d-photoscanned-human-face-c49a92f2bd6c4ec0a488bdc0e381d31c) uid c49a92f2bd6c4ec0a488bdc0e381d31c | CC BY | 188 138 f / 94 415 v | ні | Скан обличчя крупно: пори, форма носа-крил, повіки |
| 3D-5 | [3D body + head scan done with smartphone (in3D)](https://sketchfab.com/3d-models/3d-body-head-scan-done-with-smartphone-ba278d0f7800428a9f243d1d8b555234) uid ba278d0f7800428a9f243d1d8b555234 | CC BY | 18 220 f / 9 112 v | так (Mixamo-сумісний autorig), диффуз 2048 | Тіло + голова реальної людини, не ідеальна якість, але повна статура |
| 3D-6 | [Head scan (NumoScan)](https://sketchfab.com/models/d9d2b05238cb4d71935f190d4be4224d) uid d9d2b05238cb4d71935f190d4be4224d | CC BY | 50 778 f | ні | Додаткова голова (стать не вказана, відкрити й подивитися) |
| 3D-7 | [Szabi (akarity)](https://sketchfab.com/models/274ad0ead27248cc8b831705ac6383bb) uid 274ad0ead27248cc8b831705ac6383bb | CC BY | 30 732 f | ні | Скан голови, чоловік |
| 3D-8 | [Bruno Hardwick, bust (XRProfXR)](https://sketchfab.com/models/5a852b0e1f754363be98ddb6975e2df0) uid 5a852b0e1f754363be98ddb6975e2df0 | CC BY | 40 000 f | ні | Грубий старший чоловік, борода, зморшки; для скавів |
| 3D-9 | [Photogrammetry: Taylor Shockey's Head (dr00g)](https://sketchfab.com/models/62a81b56a94944858cc8990d79b5957b) uid 62a81b56a94944858cc8990d79b5957b | CC BY | 94 694 f | ні | Ще одна голова-скан |
| 3D-10 | [Male Body (Dessen)](https://sketchfab.com/models/15a422001834483c9750ce6117d59cc1) uid 15a422001834483c9750ce6117d59cc1 | CC BY | 20 764 f | ні | Реалістична чоловіча основа для пропорцій |
| 3D-11 | [Realistic Male Body Base (Nanoo)](https://sketchfab.com/models/190142906e184cf88fee479eebf56735) uid 190142906e184cf88fee479eebf56735 | CC BY | 37 056 f | ні | Ще один чоловічий бейс |
| 3D-12 | [Female anatomy / Women Highpoly (mezuna)](https://sketchfab.com/models/add580d1877b4b6fa5e4ea90edfabc35) uid add580d1877b4b6fa5e4ea90edfabc35 | CC BY | 906 589 f | ні | Висока деталізація жіночої анатомії; важка, дивитись лише як форму |
| 3D-13 | [Male & Female Base Mesh Pack (FormForge3D)](https://sketchfab.com/models/ec3041da6a214c1c995f3d47dc7d04c1) uid ec3041da6a214c1c995f3d47dc7d04c1 | CC BY | 53 030 f | ні | Описано як стилізовані; другорядне |

Порада: перед запитом на завантаження відкрити сторінку в браузері й подивитися на модель; розмір gltf-архіву
Sketchfab показує тільки в `/download` (потрібен токен), тому розміри тут не вказані. Оцінка: текстуровані скани 20-100 MB.

Не підходить (ліцензія), лише для довідки, у репо не вшивати:
- Neutral Female Head Scan, Captured Dimensions: [сторінка](https://sketchfab.com/3d-models/neutral-female-head-scan-c20ae69e1eb640b19ade6624fed10092), ліцензія Standard, не завантажується.
- Ten24 (3D Scan Store) безкоштовні голови: [чоловіча](https://www.cgchannel.com/2019/06/download-ten24s-free-hi-res-3d-scan-of-a-male-human-head/) і [жіноча](https://www.cgchannel.com/2023/09/download-ten24s-free-hi-res-3d-scan-of-a-female-human-head/): некомерційні/особисті, жіноча потребує підписки.
- Eisko (жіноча): некомерційна CC, більше не доступна.

## 6. Антропометрія та анатомія (схеми й дані)

| # | Посилання | Ліцензія/статус | Що це | Навіщо |
|---|-----------|-----------------|-------|--------|
| A-1 | [ANSUR II (US Army)](https://www.openlab.psu.edu/ansur2/) | дані публічні з 2017; умови на сторінці не вказані (державна робота США) | 4 082 чоловіки + 1 986 жінок, 93 виміри; CSV: чоловіки ~1 MB, жінки ~2 MB; Summary Report 444 с. (7.3 MB), Handbook 263 с. (5.2 MB) | ЄДИНА кількісна база: плечі (biacromial), талія, стегна, довжина ноги, висота очей, ширина/довжина голови, ширина носа/рота. Для таблиці цілей. Увага: стовпець "weightkg" насправді в гектограмах |
| A-2 | [Commons: Male human proportions](https://commons.wikimedia.org/wiki/Category:Male_human_proportions) | PD/CC, дивитися файл | Wellcome M0000424 (чоловіча фігура з пропорціями, 2693x3938), Dürer, "Man Michelangelo's Kanon" | Класична схема 7.5-8 голів |
| A-3 | [Commons: Female human proportions](https://commons.wikimedia.org/wiki/Category:Female_human_proportions) | PD/CC | Wellcome M0000423, M0000427, M0000428, L0000296 (вид спереду); Dürer, "Proportions de la femme de huit têtes" | Жіночі пропорції, співвідношення плечі/стегна |
| A-4 | [Commons: Human body proportions](https://commons.wikimedia.org/wiki/Category:Human_body_proportions) | PD/CC | загальна категорія | Різні схеми |
| A-5 | [Constructive Anatomy (Bridgman, 1920), Internet Archive](https://archive.org/details/cu31924014504371) | public domain (видання 1920 р., US) | класичний підручник | Лінії блоків: грудна клітка, таз, голова, ноги |
| A-6 | [Commons: Anthropometry](https://commons.wikimedia.org/wiki/Category:Anthropometry) | змішано | антропометричні фото й схеми | Точки вимірювання |

Не PD (лише дивитися): Loomis "Figure Drawing For All It's Worth" (перевидання 2010, [Archive.org](https://archive.org/details/AndrewLoomisFigureDrawingForAllItsWorth2010TitanPublishingGroup)): права не з'ясовані, у репо не вшивати; пропорційні правила Loomis (8 голів) можна переказувати словами.

---

## 7. Смак користувача: опис рис словами (без конкретних зірок)

Користувачу подобаються обличчя "кіно-красунь" і "популярних моделей/акторів". Конкретні фото знаменитостей НЕ
збираємо (права на образ). Нижче типажі, описані рисами; для кожного даю анонімні вільноліцензійні референси
зі схожою структурою. Мета: ОРИГІНАЛЬНІ обличчя в такому стилі, не копії.

Зв'язок зі слайдерами `FaceShape` (`packages/engine/src/shape.ts`; кожен -1..1) подано як напрямок; точні
значення підбираються порівнянням (розділ 8).

### Жінки

**W-A. "Класична кіно-красуня, пригодницька" (виразні вилиці, повні губи)**
- Вилиці: високі, помітні; щоки під ними трохи втягнуті, але без темних плям (див. коментар у `build_base.py`).
- Губи: повні, широкий рот, чіткий контур, верхня губа з виразною дугою; губи майже рівні.
- Щелепа: чітка, але гладка, подовжений овал з округлим підборіддям.
- Очі: мигдалеподібні, трохи піднятий зовнішній кут, помірні важкі повіки.
- Брови: густі, виразна дуга з піком, трохи нижче середнього.
- Ніс: прямий, помірно вузький, чітка спинка, акуратний кінчик.
- Шкіра: світло-оливкова/тепла, засмага. Вага: "сильна, спортивна".
- FaceShape: cheeks +0.5, cheekFull -0.1, lips +0.5, mouthWidth +0.3, jaw +0.1, chin 0, eyeTilt +0.3, brow/browHeight -0.1, noseWidth -0.2, noseBridge +0.1.
- Референси: W-F1 (London, жінки з вираженими вилицями: відібрати вручну), W-F4 і W-F5 (профіль), W-F7; 3D: 3D-2.

**W-B. "Вінтажний гламур" (м'яка щелепа, важкі повіки, повні губи)**
- Вилиці: ніжні, широкі, м'яке заповнення щік.
- Губи: дуже повні, виразна "дуга Купідона", трохи припухла нижня.
- Щелепа: м'яка, округле підборіддя, ніжна лінія шиї.
- Очі: великі, трохи опущені зовнішні кути, важкі повіки, довгі вії.
- Брови: дугові, вищі, тонші.
- Ніс: невеликий, ледь кирпатий кінчик.
- Шкіра: блідий порцеляновий/світлий тон, дрібні веснянки можливі.
- FaceShape: cheekFull +0.3, lips +0.6, jaw -0.3, chin -0.1, eyeSize +0.3, eyeTilt -0.2, browHeight +0.2, nose -0.2, noseTip +0.2.
- Референси: W-F9 (студійний портрет), W-F3 (Commons 3/4), W-F8.

**W-C. "Статна, темношкіра класична красуня" (широкі вилиці, повні губи, рівна щелепа)**
- Вилиці: широкі, високі; обличчя серцеподібне чи овальне.
- Губи: повні, широкий рот.
- Щелепа: чітка, м'яка по краях; підборіддя округле.
- Очі: великі, мигдалеві, широко розставлені.
- Брови: густі, чіткі.
- Ніс: ширша перенісся-основа, округлий кінчик, ширші крила.
- Шкіра: глибокий теплий коричневий (потребує окремого тону skin-мапи).
- FaceShape: cheeks +0.4, lips +0.5, noseWidth +0.4, eyeSpacing +0.1, eyeSize +0.2, jaw +0.1.
- Референси: W-F6 (Pexels), W-F8 (Pexels), W-F1 (London, відібрати вручну); 3D: підібрати окремо (жіночого темношкірого скана з CC BY не знайдено).

**W-D. "Витончена англійська краса" (довгий овал, кутасті вилиці, тонкий ніс)**
- Вилиці: кутасті, чіткі; щока злегка втягнута.
- Губи: середні, чітко окреслені, невелика різниця верх/низ.
- Щелепа: вузька, чітка; довгий підборідок.
- Очі: світлі, трохи глибоко посаджені, спокійний погляд.
- Брови: рівні, довші, помірно густі.
- Ніс: прямий, довший, вузький.
- Шкіра: світла, прохолодний підтон.
- FaceShape: headLength +0.3, cheeks +0.4, cheekFull -0.3, lips -0.1, noseWidth -0.3, nose +0.1, chinLength +0.2, jaw +0.2.
- Референси: W-F4, W-F10 (профіль), W-F2.

### Чоловіки

**M-A. "Голлівудський герой" (квадратна щелепа, пряма брова)**
- Щелепа: квадратна, виразні кути, широке підборіддя з ледь помітною ямкою.
- Брови: прямі, низько, важка надбрівна дуга.
- Очі: глибоко посаджені, прямий погляд.
- Ніс: прямий, широка спинка, чітка основа.
- Губи: середні, чіткі, ширина середня.
- Шкіра: світла-оливкова. Щетина 2-5 мм.
- FaceShape: jaw +0.6, chin +0.4, cleft +0.2, brow +0.5, browHeight -0.3, nose +0.2, noseBridge +0.2, headWidth +0.1.
- Референси: M-F1 (London, чоловіки з квадратною щелепою), M-F3, M-F7; 3D: 3D-3, 3D-1.

**M-B. "Худорлявий кутастий модельний" (високі вилиці, впалі щоки)**
- Вилиці: високі, чіткі, щоки впалі.
- Щелепа: вузька, чітка лінія, подовжене підборіддя.
- Очі: трохи опущені кути, виразні, повіки напівважкі.
- Брови: прямі, помірні.
- Ніс: довгий, вузький, прямий.
- Губи: тонші, чітка лінія.
- Шкіра: світла або засмагла.
- FaceShape: cheeks +0.5, cheekFull -0.4, jaw +0.2, chinLength +0.3, headLength +0.2, noseWidth -0.2, lips -0.3, eyeSize 0, eyeTilt -0.1.
- Референси: M-F4 (профіль), M-F5, M-F9.

**M-C. "Брутальний бородатий" (широка кістка, густа борода)**
- Щелепа: широка, під бородою; шия товста.
- Брови: густі, важкі, чітка надбрівна кістка.
- Очі: глибоко посаджені, трохи примружені.
- Ніс: широкий, з "горбинкою" можливий.
- Губи: майже сховані під бородою й вусами.
- Шкіра: загартована, засмага, зморшки біля очей.
- FaceShape: headWidth +0.3, brow +0.5, jaw +0.4, noseBridge +0.3, noseWidth +0.2, ears +0.1.
- Референси: M-F8, M-F10, 3D-8 (Bruno Hardwick), 3D-3.

**M-D. "Сильний темношкірий чоловік" (широкий ніс, високі скули, сильний підборідок)**
- Вилиці: широкі, округлі.
- Щелепа: чітка, прямокутна.
- Брови: густі, прямі.
- Очі: великі, глибокі.
- Ніс: ширше перенісся, округлі крила.
- Губи: повні, чітка лінія.
- Шкіра: глибокий коричневий.
- FaceShape: headWidth +0.2, cheeks +0.3, jaw +0.4, noseWidth +0.4, lips +0.3, chin +0.2.
- Референси: M-B6 для пропорцій фігури; для обличчя відібрати з M-F1 (London) вручну; 3D: окремо не знайдено (CC BY).

---

## 8. Як ми це використаємо

Ціль: оригінальні обличчя й тіла з хорошою анатомією через ті самі інструменти, що вже є. Розкладено на етапи.

**Етап 1. Таблиця вимірів (жодного Blender).**
1. Тіло: з ANSUR II (A-1) взяти цільові співвідношення для "атлетичної/середньої" жінки й чоловіка: ріст, bideltoid/biacromial (ширина плечей), талія, стегна (hip breadth), довжина ноги (inseam/ріст), довжина торсу, довжина руки. Записати в `refs/measure_body.csv` у частках від зросту (щоб не залежати від абсолюта).
   Додатково з 3D-1/3D-2 (Generic Man/Woman) виміряти ті самі відстані у Blender (лише для порівняння).
2. Голова: з London set (W-F1/M-F1) за 189-точковими шаблонами (є в архіві `*.zip`/CSV) порахувати: ширина обличчя / висота, відстань між очима / ширина обличчя, ширина носа / ширина обличчя, ширина рота / відстань між зіницями, довжина нижньої третини, ширина щелепи / вилиць, нахил очей. Записати в `refs/measure_face.csv` по людині й по архетипу (розділ 7).
3. Результат: для кожного архетипу W-A..D, M-A..D вектор цільових відношень (медіана 3-5 референсів, не одна людина, щоб не копіювати).

**Етап 2. Тіло: MPFB2 macros і targets.**
- `tools/assets/mpfb-pilot/build_base.py` вже задає макро-цілі (`BUILD['m'|'f']`: weight/muscle/height/proportions + targets, як-от `measure-shoulder-dist-incr`, `torso-vshape-incr`, `upperleg-muscle-incr`). Підбираємо ці числа так, щоб відношення з таблиці (етап 1) збігалися.
- Спосіб: автоматичний цикл у Blender headless: згенерувати тіло з поточними значеннями, виміряти ті самі відношення за вершинами (за групами вершин MPFB), порівняти з ціллю, зсунути значення на крок, повторити 3-5 ітерацій. Скрипт `refs/fit_body.py` (новий, поза ігровим кодом).
- Плечі/ноги, на які скаржився користувач: перевіряти два числа в першу чергу: ширина плечей / ріст і довжина ноги / ріст.

**Етап 3. Обличчя: face-targets.**
- Таргети обличчя вже задаються в `BUILD[...]['face']` (напр. `head-oval`, `cheek-bones-incr`, `mouth-upperlip-volume-incr`, `nose-scale-horiz-decr`). Для кожного архетипу зробити набір цих таргетів, додавши ключові: щелепа (`chin-*`, `chin-jaw-drop-*`), вилиці, очі, ніс.
- Порівняння: рендер голови фронт/3/4/профіль (існує `render_sheet.py`, `shot.mjs`, `hstack.mjs`) поруч із референсом у тому ж масштабі, вирівняне по зіницях і по лінії підборіддя. Підганяти, поки вимірювання (ширина носа/рота/щелепи) збігаються з цільовим вектором у межах ~5-8%.
- Не підганяти під одну людину: використовувати 3+ референси на архетип і змішувати риси (щелепа з одного, ніс з іншого, брови з третього).

**Етап 4. Запечений "поле зміщення" (apps/web/src/render/bodyShape.ts).**
- `BodyShape` (11 слайдерів: height, shoulders, chest, bust, waist, belly, hips, glutes, thighs, calves, arms) і `FaceShape` (22 слайдери: `FACE_KEYS` у `packages/engine/src/shape.ts`) вже перетворюються в поле зміщення. Після того, як базове тіло/обличчя виправлені на етапі 2-3 (нова база), прописати значення слайдерів для кожного пресету в `SHAPE_PRESETS` (напр. W-A..D, M-A..D) від таблиці вимірів.
- Перевірка тими самими вимірами в рантаймі: зробити знімок і порівняти відношення, що були в таблиці.

**Етап 5. Порівняльний рендер (кожна ітерація).**
- Лист: референс | наш рендер | різниця; фронт/3/4/профіль голови і фронт/бік/спина тіла; два масштаби (ближній і ігровий дистанційний, як `polish2_game_distance.jpg`). Фіксувати, що змінено, у `refs/ITERATIONS.md`.

**Ризики й обмеження**
- Подоба реальної людини: ніколи не підганяти під одне фото чи сканований обличчя; лише середні відношення й риси з 3+ джерел. Не публікувати порівняльні листи з реальними обличчями в репо.
- Ліцензії: CC BY вимагає атрибуції лише якщо ми розповсюджуємо похідну модель; референс-вимірювання ліцензії не торкаються, але скани (3D-1..13) не вшивати в гру без запису в `sketchfab-credits.txt`.
- Репо публічний: не класти фото/скани; лише таблиці чисел (`measure_*.csv`) і текст.
- Pexels/Unsplash: не CC0, але вільні; "не в поганому світлі": ми не публікуємо ці фото.
- Різноманіття: у наборі London мало (102 людини), для темної шкіри й старших віків його бракує; для цього Commons і Pexels, які треба відфільтрувати вручну.
- Обмеження MPFB-targets: деякі форми (дуже виразні вилиці, ширші щелепи) не вкладаються в діапазон таргетів; тоді допомагає поле зміщення (етап 4) як "останній мазок".
- Тіла ззаду й нейтральна поза в знайдених референсах слабкі: додатково знайти або покластися на 3D-1/3D-2 і ANSUR.
- Описи в розділі 7 є моїми формулюваннями типажів і напрямками слайдерів, не вимірами; перевіряти порівнянням.
