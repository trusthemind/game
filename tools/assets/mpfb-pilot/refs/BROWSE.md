# BROWSE: ручний пошук людських моделей (Sketchfab + інші джерела)

Метод: Sketchfab → Models, фільтри Downloadable + CC0 + CC BY, десятки запитів (realistic male/female body, base mesh,
rigged, athletic woman, character base, body scan, woman/man realistic, People/Characters), сортування за лайками/релевантністю.
Кожну модель відкрито у viewer (embed) → Model Inspector → Wireframe. Трикутники/ліцензія — з інфопанелі сторінки.
Нічого не завантажувалось. Скріншоти: `refs/browse/<slug>.jpg` (по одному на кандидата).

## Чесний висновок

Реалістичного, чистого, ріг-готового CC0/CC BY тіла рівня MPFB/MetaHuman на Sketchfab/OGA/Quaternius НЕМАЄ.
Є два типи: (а) чисті quad-базові меші реалістичних пропорцій без рига (James, Dessen, 0sharc, Massimo — найкращі),
(б) ріг-готові, але манекенні/low-poly (Niclas, Quaternius, Malbeasy). Фотореалістичні сканы й DAZ/CC4-персонажі —
одягнені, 150k–640k трикутників, без нейтральної пози: як база під одяг-при-завантаженні непридатні.
Найближче до задачі: James (M) + 0sharc або Massimo (F) як тільки-тіло-референс/база під власний ріг; для готового ріга
без роботи — Quaternius CC0 (але стилізований, ~13k tris).

## Таблиця (12 кандидатів; F = жіноча, M = чоловіча)

| # | slug (скріншот) | стать | URL | ліцензія | tris | ріг? | топологія (живіт / руки / плечі) | реалізм 1-5 | вади |
|---|---|---|---|---|---|---|---|---|---|
| 1 | james-realistic-male | M | https://sketchfab.com/3d-models/james-realistic-male-character-3d-model-394c101990a54fa0adfc71d3d967fa2e | CC BY | 61.1k | ні | рівна квад-сітка по всьому тілу: живіт — чіткі кільця, руки/плечі — нормальні петлі, щільне обличчя; A-поза | 4 | без рига; одягнений лише в труси; лисий, "старе" обличчя; походить з CGTrader (перевірити авторство) |
| 2 | dessen-male-body | M | https://sketchfab.com/3d-models/male-body-15a422001834483c9750ce6117d59cc1 | CC BY | 20.8k | ні | дуже чиста квад-сітка, рівномірна: живіт/груди/плечі з правильними петлями, руки з кистями; A-поза | 3.5 | груба голова/кисті, без текстур, без рига; 2018 р. |
| 3 | 0sharc-realistic-female-tpose | F | https://sketchfab.com/3d-models/realistic-female-base-mesh-t-pose-7c43f479ccc9437a90243b55d43402ee | CC BY | 67.7k | armature є в інспекторі (Animation); "auto-rig ready" — перевірити ваги | квад-сітка, живіт рівний, плечі/руки чисті, T-поза; білизна й зачіска запечені в меш | 3.5 | волосся/бікіні в мeші; модель могла бути з MetaHuman-генерації; нормальні пропорції |
| 4 | massimo-female-rig-textures | F | https://sketchfab.com/3d-models/base-mesh-female-with-rig-and-textures-cae1b75bea294b6bae9ab5d06c086089 | CC BY | 155.4k | так (Bones) | квад-сітка, акуратні петлі на животі/плечах/руках; A-поза; PBR-текстури | 3.5 | важка (155k); бікіні/волосся в мeші; походження текстур не вказано |
| 5 | jakob-gameready-female | F | https://sketchfab.com/3d-models/gameready-character-free-download-ae23036ef7e44e8abba0d929c2ffedb2 | CC BY | 64k | не заявлено (є тіло/волосся/одяг окремо) | дуже чисті квади (30k полігонів), добре підрізані петлі на плечах/ліктях | 3.5 | кіберпанк-персонаж із предметами й одягом, стиль напівреалістичний; голе тіло під одягом треба витягувати |
| 6 | niclas-basemesh-rigged-mf | M+F | https://sketchfab.com/3d-models/human-malefemale-basemesh-rigged-96fa14a5a3f0413e98b605e3f65e447c | CC BY | 37.3k (обидва) | так, T-поза | рівні квади, midpoly: живіт/руки/плечі ок | 2 | манекен, кисті "рукавички", без обличчя; 2 тіла в одному файлі |
| 7 | quaternius-universal-base-characters | M+F | https://quaternius.com/packs/universalbasecharacters.html | CC0 | ~13k/тіло | так (Humanoid rig, .blend) | low-poly game topology для анімації; T-поза; 6 тіл (Regular/Superhero/Teen) | 2.5 | напівстилізований, low-poly; wireframe лише з прев'ю на сторінці |
| 8 | malbeasy-male-tpose-rigged | M | https://sketchfab.com/3d-models/male-base-mesh-t-poserigged-5d91d2f079814476b9d471e7a09a5c39 | CC BY | 28.9k | так, T-поза | wireframe не вдалось відрендерити; shaded: гладкий атлетичний манекен | 2 | манекен без обличчя |
| 9 | ferrumiron-female-basemesh | F | https://sketchfab.com/3d-models/free-human-body-base-mesh-female-35f25ce675594c0caf611f8c0617aaf1 | CC BY | 14.8k | ні (є анімація-мітка у пошуку) | квад low-poly, ок для живота/рук, груба голова та ступні | 2 | стилізовані пропорції (широкі стегна), груба голова |
| 10 | alina-ip-jungle-jim | F | https://sketchfab.com/3d-models/alina-ip-realistic-asian-woman-animated-600d4d4aa71c4181b2567a3605ce8c57 | CC BY | 137.7k | так + анімована | дуже щільні квади, відмінні петлі, але одягнена (майка, джинси); волосся картами | 4 | зроблена з FaceGen/DAZ3D/CC4 — ліцензія контенту DAZ/CC4 може не дозволяти редистрибуцію; не нейтральна база |
| 11 | mandrake-male-highpoly | M | https://sketchfab.com/3d-models/male-body-base-mesh-highpoly-9311f4f8fa1a4fe4bb0027ff7e8fd795 | CC BY | 475.7k | ні | ZBrush-sculpt, decimated (трикутники), топології немає; анатомія дуже реалістична | 4 (як скульпт) | 476k tris, потрібен ретопо + ріг; лише референс |
| 12 | gus-female-body-base-mesh | F | https://sketchfab.com/3d-models/female-body-base-mesh-4bd94f4c0406464c91fdf55db6ca8d18 | CC BY | 30.4k | ні | квад-сітка, акуратна на животі/стегнах, A-поза | 2 | без голови, перебільшені пропорції (пісочний годинник), крихітні кисті/ступні |

Скріншоти: слаги з колонки 2 + `.jpg` у `/Users/a1111/Documents/Repositories/ashfall/tools/assets/mpfb-pilot/refs/browse/`
(для malbeasy — shaded, wireframe не відрендерився; для mandrake — крупний план скульпта; для quaternius — зображення зі сторінки пакета).

## Топ-5 (за придатністю як тіло під одяг при завантаженні)

1. james-realistic-male (M) — найкраща чиста реалістична квад-топологія, 61k, CC BY; потрібен ріг/ваги.
2. 0sharc-realistic-female-tpose (F) — реалістична жінка, чиста сітка, T-поза, є armature, CC BY; прибрати запечене волосся/білизну.
3. massimo-female-rig-textures (F) — те саме + реальний ріг і PBR, але 155k tris.
4. dessen-male-body (M) — 20.8k, ідеальні квади, A-поза, CC BY; хороший дешевий чоловічий базис (голова груба).
5. quaternius-universal-base-characters (M+F) — єдине CC0 із готовим humanoid-ригом, 6 тіл, ~13k tris; реалізм низький.

## Відхилено (дивились, але не підходить)

- Human GameReady (ca2d47d5): одяг (пальто) запечений, 50.9k, CC (не базове тіло).
- Realistic Rigged Male Character (451a6c07): "2 tris" — це рекламна картинка-біллборд, реальна модель за Google Drive лінком. Не брати.
- Anatomy study 2.0 (c3f13a4b): 304k tris скульпт, бодібілдер-анатомія.
- Realistic Male Character (c6772533): 642.6k tris фото-скан в одязі.
- Full Body Scan – Clean Pose (ae955991): 153.9k, скан в худі; Realistic Women (b1044722): 30k, скан у пальті; Just man (e77a2677): ріг+анімації, але одягнений, трикутна сітка, 44.8k.
- Human Models Set Male/Female Rigged (7311fcfd): 81k, low-poly манекени (реалізм 1).
- Renderpeople "Carla/Claudia/Eric Rigged" та "FREE DOWNLOAD …": одягнені постановочні скани (не базові тіла).
- OpenGameArt: "Human Basemeshes" (plstachio, CC0, ~1.1k–1.2k tris, ріг, low-poly "трубки") — замало деталей; "Male body subD mesh" — CC-BY-SA/GPL (не підходить за вашими умовами).

## Інші джерела (ліцензії)

- Quaternius (CC0): див. п.7. Решта Quaternius/Poly Pizza (Man, Adventurer, Animated Human…) — CC0/CC BY, але суто low-poly стилізовані.
- Poly Pizza: пошук "human" — 59 результатів, усі low-poly/стилізовані (CC0/CC BY), реалізму немає.
- OpenGameArt: див. вище; реалістичних CC0/CC BY людей не знайшов.
- itch.io: блокується Cloudflare-челенджем ("Just a moment…") — капчу не обходив, не перевірено.
- CGTrader free: сторінка category віддала 404/редирект; ліцензія CGTrader — Royalty Free (не CC), тобто все одно не підходить під "тільки CC0/CC BY". James на Sketchfab походить звідти.
- Mixamo: потрібен Adobe-логін (не вводив). За загальновідомими умовами: безкоштовно, royalty-free для ігор, але НЕ CC, ре-дистрибуція сирих моделей/анімацій у репо обмежена; тому не рекомендую (не перевірено в браузері).
- Blend Swap, ArtStation freebies: не перевіряв (ліцензії різні, часто NC/свої) — час/токени пішли на Sketchfab.

## Виглядають добре, але ліцензія НЕ CC0/CC BY (не рекомендую)

Знайдено при пошуку без фільтра ліцензії (ліцензії зчитано зі сторінок; візуально детально не оцінював):
- "Female Demo – WITH 30 ANIMATIONS–36 MORPHS" (a41b95fe…): CC BY-NC (некомерційна).
- Серії "MAN xx – WITH 250 ANIMATIONS", "Woman xx With 52 Animations 32 Morphs", "African Man Rigged Character", "Equipped American soldier in A-pose" та ін.: ліцензія Sketchfab Standard (платні/ліцензовані, не CC).
- OpenGameArt "Male body subD mesh": CC-BY-SA 3.0 / GPL.
- Mixamo, CGTrader-free: власні royalty-free ліцензії (див. вище).

## Нотатки по методу

- Wireframe у viewer: `…/models/<uid>/embed` → клавіша `i` (Model Inspector) → Wireframe. Малі зсуви миші потрібні, щоб канвас перемалювався.
- Скріншоти в панелі мають низьку роздільність (800 px), тому топологію живота/рук оцінено з крупних планів там, де вдалось; для порівняння перед завантаженням варто відкрити вибрані моделі вручну і покрутити.
- Ризик ліцензії: James і ряд інших на Sketchfab — перезаливки з CGTrader; CC BY-атрибуцію (автор + посилання) треба зберігати в CREDITS.
