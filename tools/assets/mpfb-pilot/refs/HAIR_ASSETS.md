# HAIR_ASSETS - каталог пошуку волосся/бороди (Ashfall, MPFB2-тіла)

Дата: 2026-11-16. Рейтинг 1-5 = як виглядає на МОЄМУ рендері (Blender/EEVEE на MPFB-голові, 3 ракурси), а не з прев'ю автора. ≥3.5 = завантажено. Прев'ю: `hair-assets/previews/` (`mh_*` = MakeHuman-волосся на MPFB-голові, `mpfbsys_*` = вже наявні MPFB system hair, `sf-*` = мої Blender-рендери Sketchfab-завантажень, `sfthumb_*` = прев'ю з Sketchfab API для кандидатів, яких не качав).
Вибір методу: браузер не відкривав (економія токенів) - Sketchfab API (пошук з фільтром downloadable + `license=by|cc0`) + рендер власними Blender-скриптами; wireframe не дивився, tris - з API/glTF/OBJ.

## Висновок (чесно)

- Фотореалістичного AAA-волосся (MetaHuman-рівень) безкоштовно під CC0/CC BY не знайдено. Найкраще - 4/5: Angelica (DarkNik), Curly Beatrice (CT Reed), low bun (CliffUnderside).
- Найзручніше для нашого пайплайну: MakeHuman-пакети (.mhclo + obj + png) - `HumanService.add_mhclo_asset` підганяє їх на MPFB-голову автоматично (перевірено, 60+ шт. сіли без ручної роботи). Рівень 3-3.5: стилізовані шоломоподібні/clumpy, але з нормальною лінією росту; жіночі боби, довге пряме/хвилясте, коси, пучки, афро-пучки, cornrows є.
- Sketchfab-набори (hair cards з альфою, 4/5) - довільний масштаб/позиція, потрібна ручна підгонка під голову; більшість зі 'манекенною' головою всередині файлу; 15-85k tris - для гри треба децимація/запікання.
- Чоловіче: чесно слабко (short01-04 з MPFB, culturalibre_14, ашли/maxwell). Фейди/квіф/кроп реалістичного рівня не знайшов під CC0/BY. Бороди: rehmanpolanski viking (3.5), elvs_scruffy (3.5), Bearded Man (Sketchfab, 3.5).
- Ліцензійна пастка: у MakeHuman-пакетах багато файлів мають у заголовку `.mhclo` `license AGPL3` або порожньо, хоч сторінка пакета каже CC0/CC-BY. Я ВИДАЛИВ усі з AGPL3/порожнім заголовком (окрім Elvaerwyn-hair02/bodyparts06, де сторінка пакета явно називає автора й CC-BY) - див. розділ 'відхилено'. Не використовувати їх без перевірки.

## Завантажено (шлях `refs/hair-assets/<slug>/`)

| slug | URL | author | licence | tris | formats | rating | downloaded | size | notes |
|---|---|---|---|---|---|---|---|---|---|
| sf-darknik-angelica-realistic-hair-head | https://sketchfab.com/3d-models/27f75fa94c384000bb6a79a3000f8e80 | DarkNik | CC BY 4.0 | hair 82.0k (+head 39k, всього 143.7k) | glTF+bin+png (альфа-карти, BLEND) | 4.0 | Y | 29 MB | реалістичне хвилясте каре з альфа-картками; в файлі голова/очі/вії автора (не наша). Найближче до 'реалістичного' з усього знайденого |
| sf-ctreed-curly-hair-1-beatrice | https://sketchfab.com/3d-models/89ed2c07a0d9418d9d6b231bedf2772a | CT Reed (continuumreed) | CC BY 4.0 | 39.3k (cap 1.4k + cards 37.9k) | glTF+png (alpha) | 4.0 | Y | 15 MB | щільні реалістичні кучері, довге; готове афро-/curly-покриття жіночого типу 3A-3B |
| sf-cliffunderside-messy-low-bun | https://sketchfab.com/3d-models/db7a61ea9f2c45ddb0b7571972f9738f | CliffUnderside | CC BY 4.0 | hair 6.5k (+head 8.3k), всього 14.8k | glTF+png (alpha) | 4.0 | Y | 19 MB | messy low bun + пасма, дуже економно; реальна лінія росту |
| sf-marcsawyer-long-black-hair | https://sketchfab.com/3d-models/6c06611cf3454b978c01bb98368198b2 | Marc Sawyer (whitewashstudio) | CC BY 4.0 | 39.9k | glTF+png (alpha) | 3.5 | Y | 1.7 MB | довге чорне пряме з чубком, анізо-матеріал; голови нема; потрібна підгонка |
| sf-marcsawyer-ponytail-hair | https://sketchfab.com/3d-models/8ddc5c1c6cda49bc80c9f3a675b0a6c4 | Marc Sawyer (whitewashstudio) | CC BY 4.0 | 54.7k | glTF+png (alpha) | 3.5 | Y | 2.9 MB | хвіст/пучок із пасмами, гумка; голови нема |
| sf-carlostorresvfx-long-reddish-hair | https://sketchfab.com/3d-models/0664c544ecd149d48067e3c54a90a638 | CarlosTorresVFX | CC BY 4.0 | 44.0k | glTF+png (alpha, BLEND) | 3.5 | Y | 23 MB | довге хвилясте руде, з wig-cap; є манекенна голова-силует |
| sf-digitalwitch-bobhair | https://sketchfab.com/3d-models/2149a717f39b42c9a37e04ad07e6230e | digitalwitch | CC BY 4.0 | 52.2k | glTF+png (alpha) | 3.5 | Y | 9.5 MB | боб з чубком і світлим мелірованим шаром; hair-only |
| sf-ocbacon-cornrow-braids | https://sketchfab.com/3d-models/c8052613e7894027a272e5af04ca8da4 | OCBacon | CC BY 4.0 | 11.8k | glTF+png | 3.5 | Y | 1.1 MB | cornrows + довгі коси з бусинами (box-braids-ish); сильно стилізований верх |
| sf-motionstudioarts-free-curly-hairs-01 | https://sketchfab.com/3d-models/b075e229ad2a45dbbaf0c4e80fa692a1 | MotionStudioArts | CC BY 4.0 | 85.3k | glTF+png (alpha) | 3.5 | Y | 21 MB | афро/кучеряве, cap + curl cards; важке |
| sf-motionstudioarts-small-brown-curly-hairs-05 | https://sketchfab.com/3d-models/5d92e7bd3b4f4b08ac7f27a057e0bae0 | MotionStudioArts | CC BY 4.0 | 77.2k | glTF+png (alpha) | 3.5 | Y | 11 MB | руде афро; важке, потрібна децимація |
| sf-kand8998-bearded-man-beard-haircards | https://sketchfab.com/3d-models/60947a1819a1407685cb4332e894e585 | kand8998 (KaitlynAndrus) | CC BY 4.0 | 29.9k (борода 2.6k) | glTF+png (alpha) | 3.5 | Y | 24 MB | борода+короткі hair cards на скан-подібній голові; брати лише меші бороди; атлас голови нечистий |
| makehuman-hair01-cc0/o4saken_long01 | https://static.makehumancommunity.org/assets/assetpacks/hair01.html | 04saken | CC BY 4.0 | 13268 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | layered long, realistic strand texture + normal; CC BY 4.0 |
| makehuman-hair01-cc0/toigo_blunt_bob | https://static.makehumancommunity.org/assets/assetpacks/hair01.html | MRT | CC0 | 2858 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | sleek blunt bob, strand diffuse+normal+spec; reads slightly helmet-like, clean hairline |
| makehuman-hair01-cc0/toigo_blunt_bob_with_bangs | https://static.makehumancommunity.org/assets/assetpacks/hair01.html | MRT | CC0 | 4976 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | blunt bob + bangs |
| makehuman-hair01-cc0/toigo_curled_under_bob | https://static.makehumancommunity.org/assets/assetpacks/hair01.html | MRT | CC0 | 2852 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | bob curled under |
| makehuman-hair01-cc0/toigo_curled_under_bob_with_bangs | https://static.makehumancommunity.org/assets/assetpacks/hair01.html | MRT | CC0 | 4976 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | curled bob + bangs |
| makehuman-hair01-cc0/toigo_inverted_bob | https://static.makehumancommunity.org/assets/assetpacks/hair01.html | MRT | CC0 | 2856 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | inverted (A-line) bob |
| makehuman-hair01-cc0/toigo_inverted_bob_with_bangs | https://static.makehumancommunity.org/assets/assetpacks/hair01.html | MRT | CC0 | 4996 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | inverted bob + bangs |
| makehuman-hair02-ccby/elvs_50s_updo | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 2677 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | 1950s updo, clean |
| makehuman-hair02-ccby/elvs_adrienne_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 9381 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | long side-swept |
| makehuman-hair02-ccby/elvs_ashley_may_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 8467 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | short feathered |
| makehuman-hair02-ccby/elvs_braided_rows | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 40928 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | cornrows + beads, 41k tris |
| makehuman-hair02-ccby/elvs_daisy_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 6639 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | long straight w/ bangs |
| makehuman-hair02-ccby/elvs_hazel_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC BY (pack page) | 4181 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | long wavy |
| makehuman-hair02-ccby/elvs_island_princess_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 8954 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | long straight, half-up |
| makehuman-hair02-ccby/elvs_katherine_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 5041 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | short asymmetrical/angled bob |
| makehuman-hair02-ccby/elvs_lady_hippy_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 5020 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | long straight, centre part |
| makehuman-hair02-ccby/elvs_lara_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC BY (pack page) | 27816 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | side braid / braided ponytail, 28k tris |
| makehuman-hair02-ccby/elvs_short_daisy_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 3571 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | bob w/ bangs |
| makehuman-hair02-ccby/elvs_that_80s_babe_hair | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC BY (pack page) | 6004 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | long wavy, 80s |
| makehuman-hair02-ccby/elvs_wavy_bob | https://static.makehumancommunity.org/assets/assetpacks/hair02.html | Elvaerwyn | CC_by | 4288 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | finger-wave/curly bob |
| makehuman-hair03-ccby/o4saken_chinesebob01 | https://static.makehumancommunity.org/assets/assetpacks/hair03.html | O4saken | CC BY 4.0 | 10108 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | asymmetric bob, strand tex + normal, CC BY 4.0 |
| makehuman-hair03-ccby/o4saken_curly01 | https://static.makehumancommunity.org/assets/assetpacks/hair03.html | 04saken | CC BY 4.0 | 120022 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | long curly, best curls in MH set, but 120k tris |
| makehuman-bodyparts05-cc0/rehmanpolanski_beard_viking | https://static.makehumancommunity.org/assets/assetpacks/bodyparts05.html | Rehman Polanski | CC0 | 5682 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | long scruffy beard, 5.7k |
| makehuman-bodyparts06-cc-by/elvs_scruffy_beard1 | https://static.makehumancommunity.org/assets/assetpacks/bodyparts06.html | Elvaerwyn | CC BY (pack page) | 792 | mhclo+obj+png(+mhmat) | 3.5 | Y (у складі пакета) | в пакеті | ginger scruffy beard, 0.8k tris; header blank, pack page says Elvaerwyn CC-BY |

Пакети цілком лишилися на диску (в т.ч. елементи <3.5 з чистою ліцензією - див. нижче). Розміри на диску: hair01 159 MB (6 bobs по ~25 MB через 4k-текстури), hair02 84 MB, hair03 49 MB, bodyparts05 3.6 MB, bodyparts06 10 MB. Сумарно на диску ~464 MB; сумарно скачано ~615 MB трафіку (трохи вище орієнтира 600 MB; частину потім видалив як <3.5 або з неясною ліцензією, лишилось 464 MB).

## У пакетах MakeHuman залишено, але рейтинг <3.5 (не рекомендую)

| item | author | licence | tris | rating | note |
|---|---|---|---|---|---|
| makehuman-hair01-cc0/culturalibre_hair_05 | culturalibre | CC-0 | 4948 | 3.0 | short messy, men/unisex |
| makehuman-hair01-cc0/culturalibre_hair_06 | culturalibre | CC-0 | 14688 | 1.5 | spiky pink, 14.7k tris |
| makehuman-hair01-cc0/elvs_reverse_french_braid_bun | Elvaerwyn | CC_by | 7622 | 3.0 | braid-bun, odd purple texture |
| makehuman-hair02-ccby/elvs_braid_bun | Elvaerwyn | CC BY (pack page) | 21016 | 3.0 | wicker-looking braid bun, 21k tris |
| makehuman-hair02-ccby/elvs_grump_hair | Elvaerwyn | CC BY (pack page) | 12332 | 3.0 | male comb-over |
| makehuman-hair02-ccby/elvs_inverted_curly_bob | Elvaerwyn | CC BY (pack page) | 2980 | 3.0 | messy mid-length |
| makehuman-hair02-ccby/elvs_keylth_hair | Elvaerwyn | CC BY (pack page) | 4334 | 3.0 | long ponytail-ish (tag: male) |
| makehuman-hair02-ccby/elvs_maxwell_hair | Elvaerwyn | CC_by | 1468 | 2.5 | spiky red |
| makehuman-hair02-ccby/elvs_micky_afro | Elvaerwyn | CC BY (pack page) | 1675 | 3.0 | two afro puffs, 1.7k tris, large texture |
| makehuman-hair02-ccby/elvs_short_side_do | Elvaerwyn | CC_by | 98660 | 3.0 | black bob, 98.7k tris (too heavy) |
| makehuman-hair03-ccby/culturalibre_hair_11 | culturalibre | cc-by | 44046 | 2.0 | toon, 44k tris |
| makehuman-hair03-ccby/culturalibre_hair_12 | culturalibre License CC-BY | CC BY (pack page) | 45584 | 1.5 | toon blue, 46k |
| makehuman-hair03-ccby/culturalibre_hair_13 | culturalibre | CC-by | 34425 | 2.5 | anime brown, 34k |
| makehuman-hair03-ccby/culturalibre_hair_14 | culturalibre | CC-by | 23491 | 3.0 | short men's, 23k |
| makehuman-hair03-ccby/culturalibre_hair_17 | culturalibre | CC-BY | 13392 | 3.0 | long wavy, texture pinkish |
| makehuman-hair03-ccby/culturalibre_hair_18 | culturalibre | CC-BY | 7992 | 3.0 | bob w/ bangs |
| makehuman-bodyparts05-cc0/culturalibre_faun_beard | culturalibre | CC-0 | 10432 | 2.0 | thin chin-strap |
| makehuman-bodyparts05-cc0/rehmanpolanski_moustache_viking | Rehman Polanski | CC0 | 1364 | 3.0 | small moustache |
| makehuman-bodyparts06-cc-by/culturalibre_dal_moustache | culturalibre | CC-BY | 1672 | 3.0 | thin Dali moustache |

## Відхилено/видалено через неясну ліцензію (прев'ю лишилися)

Заголовок .mhclo = `AGPL3` або порожній, хоч сторінка пакета каже CC0/CC-BY (стандартний штамп MakeHuman для старих/неатрибутованих файлів). Файли видалені з диска.

| item | pack | header licence | як виглядало (мій рейтинг) |
|---|---|---|---|
| cortu_shaggy_green_hair | makehuman-hair01-cc0 | blank | <3.5 |
| cortu_short_messy_hair | makehuman-hair01-cc0 | blank | <3.5 |
| cortu_straight_bangs | makehuman-hair01-cc0 | blank | <3.5 |
| cortu_strawberry_cloud_hair | makehuman-hair01-cc0 | blank | <3.5 |
| culturalibre_hair_01 | makehuman-hair01-cc0 | AGPL3 (see also http | довге чорне пряме, 3.5 |
| culturalibre_hair_02 | makehuman-hair01-cc0 | AGPL3 (see also http | коротке чоловіче, 3.0 |
| elvs_double_mh_braid | makehuman-hair01-cc0 | AGPL3 (see also http | дві коси, 3.5 |
| elvs_french_braid_variation | makehuman-hair01-cc0 | AGPL3 (see also http | французька коса, 3.5 |
| elvs_unkempt_french_braid | makehuman-hair01-cc0 | AGPL3 (see also http | неакуратна коса, 3.5 |
| faydaen_hair_1 | makehuman-hair01-cc0 | blank | <3.5 |
| learning_anime_hair | makehuman-hair01-cc0 | AGPL3 (see also http | <3.5 |
| littleright_bobcut_hair | makehuman-hair01-cc0 | AGPL3 (see also http | <3.5 |
| rehmanpolanski_hair_bun_brown | makehuman-hair01-cc0 | AGPL3 (see also http | пучок, 3.5 |
| sonntag78_blond_with_headband | makehuman-hair01-cc0 | AGPL3 (see also http | <3.5 |
| sonntag78_junglebook_hair | makehuman-hair01-cc0 | AGPL3 (see also http | <3.5 |
| elvs_witchy_lil_bob | makehuman-hair02-ccby | AGPL3 (see also http | <3.5 |
| grinsegold_wig_bow_tie | makehuman-hair03-ccby | AGPL3 (see also http | <3.5 |
| grinsegold_wig_bun_blonde_braids | makehuman-hair03-ccby | AGPL3 (see also http | <3.5 |
| punkduck_alpha7_curly | makehuman-hair03-ccby | AGPL3 (see also http | кучеряве, 3.5 |
| punkduck_alpha7_curly2 | makehuman-hair03-ccby | AGPL3 (see also http | кучеряве довге, 3.5 |
| punkduck_alpha7_long | makehuman-hair03-ccby | AGPL3 (see also http | довге, 3.5 |
| grinsegold_beard_sigmund_wip | makehuman-bodyparts05-cc0 | AGPL3 (see also http | сива борода, 3.0 |
| wdg_scruffy_beard | makehuman-bodyparts05-cc0 | AGPL3 (see also http | щетинна, 3.0 |
| grinsegold_full_beard | makehuman-bodyparts06-cc-by | AGPL3 (see also http | повна борода, 3.5 |
| grinsegold_moustache | makehuman-bodyparts06-cc-by | AGPL3 (see also http | <3.5 |

Якщо потрібні - ліцензію треба підтвердити в автора/репозиторії MakeHuman (makehumancommunity.org/node/...), інакше не вживати.

## Вже було на диску: MPFB system assets (CC0, makehuman_system_assets_cc0.zip) - НЕ завантажував

Джерело: `~/.cache/ashfall-src/mpfb/system-assets/makehuman_system_assets_cc0.zip` (+ у Blender MPFB). Прев'ю `previews/mpfbsys_*.jpg`. Рейтинг для всіх ≈3.0: гладкі текстуровані 'шоломи' з окремими пасмами, лінія росту ок, жодного 'карткового' реалізму.

| item | tris | rating | note |
|---|---|---|---|
| afro01 | 2192 | 3.0 | CC0 (system assets), obj+diffuse png |
| bob01 | 8474 | 3.0 | CC0 (system assets), obj+diffuse png |
| bob02 | 2248 | 3.0 | CC0 (system assets), obj+diffuse png |
| braid01 | 5518 | 3.0 | CC0 (system assets), obj+diffuse png |
| long01 | 4108 | 3.0 | CC0 (system assets), obj+diffuse png |
| ponytail01 | 5352 | 3.0 | CC0 (system assets), obj+diffuse png |
| short01 | 3678 | 3.0 | CC0 (system assets), obj+diffuse png |
| short02 | 3344 | 3.0 | CC0 (system assets), obj+diffuse png |
| short03 | 1922 | 3.0 | CC0 (system assets), obj+diffuse png |
| short04 | 1050 | 3.0 | CC0 (system assets), obj+diffuse png |

## Sketchfab: завантажено й видалено (<3.5), не завантажено

| slug/uid | author | licence | tris | rating | чому не взяв |
|---|---|---|---|---|---|
| ctreed-curly-hair-2-angel (a0f33a63) | CT Reed | CC BY | 24.6k | 3.0 | блідо-кучерявий пух, нечиста форма |
| ctreed-afro-rose (4b2ab828) | CT Reed | CC BY | 24.0k | 3.0 | темний пух; рендер не вдався (430 вузлів), на прев'ю чорна хмара |
| daaghrii-beautiful-hair-4 (8ffcd350) | DaaGHrii | CC BY | 18.3k | 3.0 | плоский боб без прозорості пасом |
| alexm777 female hair bun / ponytail v2 (96f38f5e, 0521eb5f) | AlexM777 | CC BY | 38k / 35k | 2.5 | без текстур, аніме-плоскі шматки |
| miccall female hairs (0a391b65) | miccall | CC BY | 51k | 2.5 | 9 стилізованих (рожеві) стилів без alpha |
| VincentFreelance: 12 woman hairstyles 02/09, 21 hairstyles, male fashion 01 (cdcc0d80, a2464050, 6a876007, 2735370f; ще 02/07/08/bd74c3f6,bf63cecf,a60076cc) | Vincent Freelance | CC BY | 600k-915k на набір (~40-60k/стиль) | 3.0 | сірий скульпт без текстур/альфа, важкий; багато стилів (боби, пучки, коси, чоловічі), але без retopo/запікання не годиться |
| polytricity beard-1 (f4f8c69f) | POLYTRICITY | CC BY | 2k | 3.0 | картковий 'килимок', 33 MB текстур |
| rendysix Hair Pack 1/2/3 (41f1709e, 06a783e9, 9dc99938) | rendysix | CC BY | 168k / 176k / 37k | 3.0 | сірі ігрові стилі, по ~14 на пак; не завантажував (вага, стилізація) |
| _polybit_ Girl hair (a5e791b3), Elegant Ponytail (b2d820ee), Long Wavy Hair (e4be2ec6) | _polybit_ | CC BY | 286k / 938k / 711k | 3.5 | виглядають добре (3.5-4), але 285k-938k tris і до 85 MB - не вкладаються у бюджет |
| MotionStudioArts: Thick Curly v7.1 (d4b56247), Brown Kink 08 (0a77bd1b), Black Short Curl 06 (0f77a56b), Fuzzy v2 (b9519625), Curly Brown 04 (3b34362e) | MotionStudioArts | CC BY | 97k-529k | 3.5 | афро/кучеряві; дублюють вже взяті 2 набори, надто важкі |
| zHairezt (десятки: ponytail, buns, braids...) | zHairezt | CC BY | 5k-33k | 2.0 | Zepeto/Roblox-стилізація, не реалізм |
| tikoavp toon dreads (187c1dd0, 3a7499ea) | tikoavp | CC BY (+CC0 на OGA) | 46-88k | 2.0 | toon |
| caseydedore Tech Braids (e2fd4f29), jn3design Head curly hair (82c8f00d) | - | CC BY | 463k-653k | 3.0 | сирий скульпт на бюсті |
| chambersu1996 Hair for Ray II (aaa7d929) | ChamberSu | CC BY | 92k | 3.0 | стилізований |
| Sketchfab CC0 hair | - | CC0 | - | - | Моделей волосся під CC0 на Sketchfab (downloadable) не знайшов: CC0-видача - музейні скани/статуї |

## Інші джерела

- MakeHuman community (static.makehumancommunity.org/assets): hair01/02/03, bodyparts05/06 - див. вище. Hair editor / system_hair_materials - не брав (функціональні, не геометрія).
- OpenGameArt (CC0, Micket: короткий punk 374 tris, довге чоловіче 253 tris; tikoavp toon dreads): low-poly 2/5, не качав.
- itch.io: безкоштовного CC0/CC-BY hair-card пакета не знайшов (Cloudflare не зустрів). CGTrader/Renderhub/Superhive/Blender Market: платні/'Royalty Free', не CC - виключено.
- Blend Swap, Poly Pizza, Quaternius, Free3D: глибоко не проглядав; Quaternius (CC0) - лише стилізовані low-poly зачіски (2/5).
- Додатково: Cinevva-блог (app.cinevva.com/blog/hair/library/LICENSE.txt) перелічує ті самі MakeHuman Hair01 + system assets (CC0) і OGA toon dread ponytail - нічого нового.

## Рекомендації для жіночих стилів

1. Реалізм (hair cards, потрібна підгонка): Angelica (каре, хвилі), Beatrice (довге кучеряве), CliffUnderside (низький пучок), Marc Sawyer (довге пряме з чубком, хвіст), CarlosTorres (довге хвилясте), digitalwitch (боб з чубком), OCBacon (коси).
2. Готові до MPFB (автопідгонка, дешево): toigo bobs (6, CC0), Elvaerwyn: wavy_bob, 50s_updo, adrienne, hazel, katherine (кут. боб), short_daisy, island_princess, lady_hippy, lara (коса), braided_rows (cornrows), o4saken chinesebob/long01/curly01 (curly01 120k - децимувати).
3. Афро/пучки: Elvaerwyn micky_afro (3.0, два пучки), MotionStudioArts curly 01/05 (3.5, важко).
4. Чоловіче/борода: rehmanpolanski beard+moustache, elvs_scruffy_beard1, Bearded Man; зачіски чоловічі - лише MPFB short01-04 (3.0).
