import type { Choice, DialogueNode, Effect, NpcDef, Relationship } from './types';

const node = (id: string, text: string, choices: Choice[], effects?: Effect[], speaker: DialogueNode['speaker'] = 'npc'): DialogueNode => ({
  id,
  speaker,
  text,
  choices,
  effects,
});
const bye = (text = 'Бувай.'): Choice => ({ text, next: null });

// ─────────────────────────────────────────────────────────────────────────────
// Олена — польова медикиня. Зустрічається пораненою в рейді; може стати компаньйонкою і партнеркою.
// ─────────────────────────────────────────────────────────────────────────────
const lena: NpcDef = {
  id: 'lena',
  name: 'Олена',
  role: 'Field medic',
  bio: 'Колишня фельдшерка швидкої. Після Попелу лікувала всіх, хто платив, і тих, хто не міг.',
  color: '#7fd1b9',
  canRecruit: true,
  romanceable: true,
  home: 'raid',
  prefers: ['clinic', 'house'],
  entries: [
    { cond: { inRaid: true, companion: true }, node: 'l_raid_comp' },
    { cond: { inRaid: true, notFlag: 'met' }, node: 'l_meet' },
    { cond: { inRaid: true }, node: 'l_raid_again' },
    { cond: { flag: 'robbed', maxAffinity: -10 }, node: 'l_cold' },
    { cond: { notFlag: 'base_intro' }, node: 'l_base_intro' },
    { cond: { flag: 'romance' }, node: 'l_partner' },
    { node: 'l_hub' },
  ],
  nodes: {
    l_meet: node(
      'l_meet',
      'Під стіною сидить жінка в брудній медичній куртці й притискає закривавлений бинт до стегна. Пістолет у її руці тремтить — і повільно опускається.\n\n«Не стріляй. Я не з них. Мене звати Олена. Я… медик. Була медиком.»',
      [
        { text: 'Тихо. Я не ворог. Що сталося?', next: 'l_story', effects: [{ affinity: 5 }] },
        { text: '[Бинт] Тримай, перев\'яжи ногу.', next: 'l_thanks', cond: { hasItem: { def: 'bandage' } }, effects: [{ take: { def: 'bandage' } }, { healNpc: true }, { affinity: 20 }, { flag: 'helped' }] },
        { text: '[AI-2] Ось аптечка.', next: 'l_thanks', cond: { hasItem: { def: 'ai2' } }, effects: [{ take: { def: 'ai2' } }, { healNpc: true }, { affinity: 25 }, { flag: 'helped' }] },
        { text: 'Віддавай усе, що маєш. Повільно.', next: 'l_robbed', effects: [{ affinity: -40 }, { flag: 'robbed' }] },
        { text: 'Не моя справа. (Піти)', next: null, effects: [{ affinity: -10 }, { flag: 'left' }] },
      ],
      [{ flag: 'met' }],
    ),
    l_story: node(
      'l_story',
      '«Мародери накрили нашу групу біля клініки. Я втекла, але мене зачепило. Кров ніяк не зупиняється… Якщо маєш бинт — я поверну борг. Колись.»',
      [
        { text: '[Бинт] Тримай.', next: 'l_thanks', cond: { hasItem: { def: 'bandage' } }, effects: [{ take: { def: 'bandage' } }, { healNpc: true }, { affinity: 20 }, { flag: 'helped' }] },
        { text: '[AI-2] Візьми аптечку.', next: 'l_thanks', cond: { hasItem: { def: 'ai2' } }, effects: [{ take: { def: 'ai2' } }, { healNpc: true }, { affinity: 25 }, { flag: 'helped' }] },
        { text: 'Тримайся. Пошукаю щось поблизу.', next: null, effects: [{ affinity: 3 }, { flag: 'promised' }] },
        { text: 'Вибач. Мені треба йти.', next: null, effects: [{ affinity: -8 }] },
      ],
    ),
    l_thanks: node(
      'l_thanks',
      'Вона затягує вузол зубами й видихає.\n\n«Дякую… Чесно, я думала, що тут і залишусь. Ти не схожий на інших. Ну, трохи схожий. Але не дуже.»',
      [
        { text: 'Ходімо разом. До виходу вдвох безпечніше.', next: 'l_join', effects: [{ joinNow: true }, { flag: 'rescued' }, { affinity: 10 }] },
        { text: 'Йди до старого депо. Знайдеш Миколу — скажи, що від мене.', next: 'l_bye_base', effects: [{ flag: 'rescued' }, { flag: 'at_base' }, { affinity: 5 }] },
        { text: 'Бережи себе.', next: null },
      ],
    ),
    l_join: node('l_join', '«Добре. Тільки не біжи як скажений — я накульгую. І якщо почнеться стрілянина, я за тобою, а не перед тобою.»', [{ text: 'Домовились.', next: null }]),
    l_bye_base: node('l_bye_base', '«Депо… Микола. Запам\'ятала. Не помирай там, гаразд? Я ще хочу віддати борг.»', [bye('Побачимось.')]),
    l_robbed: node(
      'l_robbed',
      'Вона мовчки висипає вміст кишень на підлогу. Не дивиться на тебе.\n\n«Забирай. Сподіваюся, воно тобі допоможе.»',
      [{ text: '(Забрати гроші й піти)', next: null, effects: [{ money: 6000 }] }],
    ),
    l_raid_again: node('l_raid_again', '«Знову ти. Світ тісний — навіть тепер.»', [
      { text: '[Бинт] Як нога? Тримай ще бинт.', next: 'l_thanks', cond: { hasItem: { def: 'bandage' }, notFlag: 'helped' }, effects: [{ take: { def: 'bandage' } }, { healNpc: true }, { affinity: 18 }, { flag: 'helped' }] },
      { text: 'Ходімо разом до виходу.', next: 'l_join', cond: { minAffinity: 10 }, effects: [{ joinNow: true }, { flag: 'rescued' }] },
      bye('Бувай.'),
    ]),
    l_raid_comp: node('l_raid_comp', '«Я поруч. Кажи, якщо треба перев\'язка — або якщо треба когось тихо прибрати.»', [
      { text: 'Маєш зайвий бинт?', next: 'l_comp_bandage', cond: { minAffinity: 25 }, once: true, effects: [{ give: { def: 'bandage' } }] },
      { text: 'Як ти?', next: 'l_comp_how' },
      bye('Тримайся позаду.'),
    ]),
    l_comp_bandage: node('l_comp_bandage', '«Останній. Не марнуй — це не серветка.»', [bye('Дякую.')]),
    l_comp_how: node('l_comp_how', '«Живу. Дивлюсь, щоб і ти жив. Поки що виходить.»', [bye('Пішли далі.')]),
    l_cold: node('l_cold', 'Олена навіть не повертає голови. «Чого тобі? Ще щось забрати хочеш?»', [
      { text: '[10 000 кр] Вибач за той раз. Це компенсація.', next: 'l_forgive', cond: { minMoney: 10000 }, effects: [{ money: -10000 }, { affinity: 45 }, { unflag: 'robbed' }] },
      bye('Нічого.'),
    ]),
    l_forgive: node('l_forgive', '«…Гроші не все виправляють. Але це початок. Не змушуй мене пошкодувати.»', [bye('Не змушу.')]),
    l_base_intro: node(
      'l_base_intro',
      '«Отже, це і є ваш „табір“. Микола напоїв мене чаєм із чогось, що він називає чаєм. Я жива. Дякую тобі за це.»',
      [
        { text: 'Як нога?', next: 'l_leg', effects: [{ affinity: 3 }] },
        { text: 'Розкажи про себе.', next: 'l_past', effects: [{ affinity: 5 }] },
      ],
      [{ flag: 'base_intro' }],
    ),
    l_leg: node('l_leg', '«Заживе. Шрам буде гарний — як мапа метро. Пообіцяй, що не будеш тягнути мене в підвали з мародерами частіше, ніж раз на тиждень.»', [
      { text: 'Нічого не обіцяю.', next: 'l_hub', effects: [{ affinity: 2 }] },
    ]),
    l_hub: node('l_hub', 'Олена перебирає ампули у бляшаній коробці. «Що таке?»', [
      { text: 'Розкажи про себе.', next: 'l_past', once: true, effects: [{ affinity: 5 }] },
      { text: 'Що сталося з твоєю групою?', next: 'l_group', once: true, cond: { minTalks: 2 }, effects: [{ affinity: 6 }] },
      { text: 'Тобі щось потрібно?', next: 'l_quest', cond: { notFlag: 'q_salewa_active', flag: 'base_intro' }, once: true },
      { text: '[Salewa] Ось аптечка, як ти просила.', next: 'l_quest_done', cond: { flag: 'q_salewa_active', hasItem: { def: 'salewa' } }, effects: [{ take: { def: 'salewa' } }, { affinity: 15 }, { unflag: 'q_salewa_active' }, { flag: 'q_salewa_done' }, { give: { def: 'ifak' } }] },
      { text: 'Підеш зі мною в наступний рейд?', next: 'l_recruit', cond: { minAffinity: 35, companion: false } },
      { text: 'Цього разу залишся в таборі.', next: 'l_dismiss', cond: { companion: true }, effects: [{ dismiss: true }] },
      { text: 'Олено… я хочу тобі дещо сказати.', next: 'l_romance', cond: { stage: ['close'], notFlag: 'romance_no' }, once: true },
      bye(),
    ]),
    l_past: node('l_past', '«Шість років на швидкій. Знаєш, що найстрашніше? Не кров. Тиша в машині, коли вже пізно. Коли все почалось, я просто… продовжила їздити. Тільки машини вже не було.»', [
      { text: 'Ти сильніша, ніж думаєш.', next: 'l_hub', effects: [{ affinity: 4 }] },
      { text: 'Тепер у тебе є ми.', next: 'l_hub', effects: [{ affinity: 3 }] },
    ]),
    l_group: node('l_group', '«Нас було п\'ятеро. Два брати, старий Петрович і дівчинка, Соня. Мародери забрали все — і їх теж. Я досі чую, як Соня кличе мене. Якщо колись знайдеш жовтий рюкзак з наліпкою-котом… просто скажи мені.»', [
      { text: 'Я шукатиму.', next: 'l_hub', effects: [{ affinity: 6 }, { flag: 'promised_sonya' }] },
      { text: 'Мені шкода.', next: 'l_hub', effects: [{ affinity: 2 }] },
    ]),
    l_quest: node('l_quest', '«Мені потрібна нормальна аптечка — Salewa. Ці бинти — як латати човен скотчем. Принеси, і я віддячу чимось кращим.»', [
      { text: 'Домовились.', next: 'l_hub', effects: [{ flag: 'q_salewa_active' }] },
    ]),
    l_quest_done: node('l_quest_done', '«Справжня Salewa! Тримай IFAK — я його зібрала сама. І… дякую. Ти тримаєш слово.»', [{ text: 'Завжди.', next: 'l_hub' }]),
    l_recruit: node('l_recruit', '«Я думала, ти ніколи не спитаєш. Аптечки несу я, а ти — все важке. І ніяких геройств.»', [
      { text: 'Ніяких геройств.', next: 'l_hub', effects: [{ recruit: true }, { affinity: 3 }] },
    ]),
    l_dismiss: node('l_dismiss', '«Добре. Тоді повернись живим — інакше сама прийду й уб\'ю.»', [{ text: 'Повернусь.', next: 'l_hub' }]),
    l_romance: node('l_romance', 'Вона відкладає ампули й дивиться прямо на тебе. «…Я слухаю.»', [
      { text: 'Ти — найкраще, що сталося зі мною після кінця світу.', next: 'l_romance_yes', effects: [{ flag: 'romance' }, { affinity: 15 }] },
      { text: 'Дякую, що ти поруч. Ти справжній друг.', next: 'l_friend', effects: [{ flag: 'romance_no' }, { affinity: 5 }] },
    ]),
    l_romance_yes: node('l_romance_yes', 'Олена довго мовчить. Потім усміхається — вперше по-справжньому.\n\n«Дурень. Я це знала ще в тому підвалі.»', [{ text: '(Обійняти її)', next: null, effects: [{ affinity: 5 }] }]),
    l_friend: node('l_friend', '«Друг. Так. Це теж багато. Особливо тепер.»', [{ text: 'Так.', next: 'l_hub' }]),
    l_partner: node('l_partner', 'Олена кладе голову тобі на плече. «Знову йдеш? Тоді йди обережно. Я не для того тебе латала.»', [
      { text: 'Підеш зі мною?', next: 'l_recruit', cond: { companion: false } },
      { text: 'Цього разу залишся.', next: 'l_dismiss', cond: { companion: true }, effects: [{ dismiss: true }] },
      { text: 'Поговорімо ще.', next: 'l_hub' },
      bye('Я скоро.'),
    ]),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Микола — старий друг, механік. Живе в таборі з самого початку.
// ─────────────────────────────────────────────────────────────────────────────
const mykola: NpcDef = {
  id: 'mykola',
  name: 'Микола',
  role: 'Mechanic · old friend',
  bio: 'Друг ще з технікуму. Може полагодити все, крім власного життя.',
  color: '#e0b25b',
  canRecruit: true,
  romanceable: false,
  home: 'hideout',
  entries: [
    { cond: { inRaid: true }, node: 'm_raid' },
    { cond: { notFlag: 'intro' }, node: 'm_intro' },
    { node: 'm_hub' },
  ],
  nodes: {
    m_intro: node(
      'm_intro',
      '«О, живий! Я вже думав, тебе в тому підвалі й поховали. Поки ти відсипався, я зібрав тобі дещо: пістолет, ніж, трохи патронів. Не дякуй. Добре, дякуй.»',
      [
        { text: 'Дякую, Миколо. Що тут узагалі відбувається?', next: 'm_lore', effects: [{ affinity: 3 }] },
        { text: 'Де можна заробити?', next: 'm_work' },
        bye('Пізніше.'),
      ],
      [{ flag: 'intro' }],
    ),
    m_lore: node(
      'm_lore',
      '«Попіл. Так це назвали по радіо, поки воно ще працювало. Хмара прийшла з заходу, і за тиждень пів міста стало… не людьми. Інфіковані. Решта поділилась на тих, хто грабує, і тих, кого грабують. Ми — третій варіант: заходимо, беремо, виходимо.»',
      [
        { text: 'А хто такі рейдери?', next: 'm_raiders' },
        { text: 'Зрозумів.', next: 'm_hub' },
      ],
    ),
    m_raiders: node('m_raiders', '«Колишні військові та приватники. Хороше залізо, погані манери. Стріляють першими. Зате з них падає броня класу «мама не горюй». А на військовій базі сидить Костя-Воєвода зі своєю охороною — туди без нормального спорядження не лізь.»', [
      { text: 'Учту.', next: 'm_hub', effects: [{ affinity: 2 }] },
    ]),
    m_hub: node('m_hub', 'Микола витирає руки ганчіркою. «Ну що, брате?»', [
      { text: 'Розкажи ще раз, що тут відбувається.', next: 'm_lore' },
      { text: 'Є робота?', next: 'm_work', cond: { notFlag: ['q_tools_active', 'q_tools_done'] } },
      { text: '[Toolset] Ось твій набір інструментів.', next: 'm_tools_done', cond: { flag: 'q_tools_active', hasItem: { def: 'tools' } }, effects: [{ take: { def: 'tools' } }, { money: 25000 }, { affinity: 10 }, { unflag: 'q_tools_active' }, { flag: 'q_tools_done' }] },
      { text: 'Ще щось треба?', next: 'm_batt', cond: { flag: 'q_tools_done', notFlag: 'q_batt_active' }, once: true },
      { text: '[Car battery] Акумулятор, як замовляв.', next: 'm_batt_done', cond: { flag: 'q_batt_active', hasItem: { def: 'battery' } }, effects: [{ take: { def: 'battery' } }, { affinity: 12 }, { unflag: 'q_batt_active' }, { flag: 'q_batt_done' }, { give: { def: 'b_pilgrim' } }] },
      { text: 'Як ти сам тримаєшся?', next: 'm_personal', once: true, cond: { minTalks: 3 }, effects: [{ affinity: 8 }] },
      { text: 'Підеш зі мною в рейд?', next: 'm_recruit', cond: { minAffinity: 50, companion: false } },
      { text: 'Посидь цього разу на базі.', next: 'm_dismiss', cond: { companion: true }, effects: [{ dismiss: true }] },
      bye(),
    ]),
    m_work: node('m_work', '«Робота завжди є. Мені потрібен набір інструментів — у гаражах і на складах трапляються. Принесеш — заплачу 25 тисяч. Чесно.»', [
      { text: 'Берусь.', next: 'm_hub', effects: [{ flag: 'q_tools_active' }] },
      { text: 'Не зараз.', next: 'm_hub' },
    ]),
    m_tools_done: node('m_tools_done', '«Оце я розумію! Тримай гроші. Тепер я нарешті доберусь до того генератора.»', [{ text: 'Звертайся.', next: 'm_hub' }]),
    m_batt: node('m_batt', '«Генератор без акумулятора — просто дуже важкий стілець. Знайди мені автомобільний акумулятор — у машинах на дорогах бувають. Віддам свій старий рюкзак «Пілігрим».»', [
      { text: 'Домовились.', next: 'm_hub', effects: [{ flag: 'q_batt_active' }] },
    ]),
    m_batt_done: node('m_batt_done', 'Генератор кашляє, чхає — і над табором загоряється лампочка. Микола сміється, як дитина.\n\n«Світло! Тримай рюкзак, ти заслужив.»', [{ text: 'Хай світить.', next: 'm_hub' }]),
    m_personal: node('m_personal', '«Знаєш… Моя Галя з дітьми встигли виїхати до Львова, ще до блокпостів. Я кажу собі, що вони там. Що там є світло, і вода, і школа. Кажу щодня. Іноді навіть вірю.»', [
      { text: 'Вони там, Миколо. Я впевнений.', next: 'm_hub', effects: [{ affinity: 5 }] },
      { text: '(Мовчки покласти руку на плече)', next: 'm_hub', effects: [{ affinity: 6 }] },
    ]),
    m_recruit: node('m_recruit', '«Ха! Думав, не попросиш. Беру свою стару рушницю… жартую, беру що дадуть. Головне — не лізь під кулі першим, я вже не такий швидкий.»', [
      { text: 'Разом, як колись.', next: 'm_hub', effects: [{ recruit: true }, { affinity: 3 }] },
    ]),
    m_dismiss: node('m_dismiss', '«Та й добре. Буду тут, з генератором. Він хоч не стріляє.»', [{ text: 'Бережи табір.', next: 'm_hub' }]),
    m_raid: node('m_raid', '«Чуєш? Тихо. Аж занадто. Не подобається мені це.»', [bye('Тримайся поруч.')]),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Віра — торговка. Стосунки з нею знижують ціни.
// ─────────────────────────────────────────────────────────────────────────────
const vera: NpcDef = {
  id: 'vera',
  name: 'Віра',
  role: 'Trader',
  bio: 'Тримає склад у підвалі депо. Знає ціну всьому, а вартість — нічому.',
  color: '#c792ea',
  canRecruit: false,
  romanceable: false,
  home: 'hideout',
  entries: [{ cond: { notFlag: 'intro' }, node: 'v_intro' }, { node: 'v_hub' }],
  nodes: {
    v_intro: node('v_intro', '«Віра. Купую, продаю, питань не ставлю. Ціни не обговорюються. Майже.»', [
      { text: 'Покажи товар.', next: null, effects: [{ openTrade: true }] },
      { text: '«Майже»?', next: 'v_almost' },
    ], [{ flag: 'intro' }]),
    v_almost: node('v_almost', '«Тим, хто мені подобається, роблю знижку. Поки що ти мені не подобаєшся. Але й не дратуєш. Це вже щось.»', [
      { text: 'Попрацюю над цим.', next: 'v_hub', effects: [{ affinity: 3 }] },
    ]),
    v_hub: node('v_hub', 'Віра дивиться поверх окулярів. «Знову ти. Гроші є?»', [
      { text: 'Торгувати.', next: null, effects: [{ openTrade: true }] },
      { text: 'Можу щось для тебе знайти?', next: 'v_quest', cond: { notFlag: ['q_intel_active', 'q_intel_done'] } },
      { text: '[Intelligence folder] Твоя папка.', next: 'v_done', cond: { flag: 'q_intel_active', hasItem: { def: 'intel' } }, effects: [{ take: { def: 'intel' } }, { affinity: 20 }, { money: 60000 }, { unflag: 'q_intel_active' }, { flag: 'q_intel_done' }] },
      { text: 'Зробиш знижку старому клієнту?', next: 'v_discount', cond: { minAffinity: 25 }, once: true, effects: [{ affinity: 5 }] },
      bye(),
    ]),
    v_quest: node('v_quest', '«На військовій базі є сейфи. В одному з них — папка з розвідданими. Принеси її мені, і я заплачу 60 тисяч. І запам\'ятаю.»', [
      { text: 'Домовились.', next: 'v_hub', effects: [{ flag: 'q_intel_active' }] },
    ]),
    v_done: node('v_done', '«Ціла. Навіть не відкривав? Розумник. Тримай гроші — і відтепер ціни для тебе трохи кращі.»', [{ text: 'Приємно мати справу.', next: 'v_hub' }]),
    v_discount: node('v_discount', '«Знижка? Ха. …Гаразд. Але тільки тому, що ти не торгуєшся, як мій колишній.»', [{ text: 'Дякую.', next: 'v_hub' }]),
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// Тарас — колишній прикордонник, снайпер. Зустрічається без набоїв, затиснутий на військових об'єктах.
// ─────────────────────────────────────────────────────────────────────────────
const taras: NpcDef = {
  id: 'taras',
  name: 'Тарас',
  role: 'Marksman · ex border guard',
  bio: 'Дев\'ять років на кордоні. Говорить мало, стріляє влучно, рахує кожен патрон.',
  color: '#9fb36a',
  canRecruit: true,
  romanceable: false,
  home: 'raid',
  prefers: ['military', 'warehouse'],
  entries: [
    { cond: { inRaid: true, companion: true }, node: 't_raid_comp' },
    { cond: { inRaid: true, notFlag: 'met' }, node: 't_meet' },
    { cond: { inRaid: true }, node: 't_raid_again' },
    { cond: { notFlag: 'base_intro' }, node: 't_base_intro' },
    { node: 't_hub' },
  ],
  nodes: {
    t_meet: node(
      't_meet',
      'З-за ящиків на тебе дивиться ствол гвинтівки. Потім чоловік у вицвілій прикордонній формі опускає її і криво всміхається.\n\n«Не напружуйся. Порожня. Останній патрон пішов на того, хто сидить за рогом. Тарас.»',
      [
        { text: 'Скільки їх там?', next: 't_situation', effects: [{ affinity: 4 }] },
        { text: '[MRE] Тримай пайок. Виглядаєш так, ніби тиждень не їв.', next: 't_thanks', cond: { hasItem: { def: 'mre' } }, effects: [{ take: { def: 'mre' } }, { healNpc: true }, { affinity: 18 }, { flag: 'helped' }] },
        { text: '[Сухарі] Небагато, але бери.', next: 't_thanks', cond: { hasItem: { def: 'crackers' } }, effects: [{ take: { def: 'crackers' } }, { healNpc: true }, { affinity: 12 }, { flag: 'helped' }] },
        { text: 'Гвинтівку на землю. І кишені.', next: 't_robbed', effects: [{ affinity: -45 }, { flag: 'robbed' }] },
        { text: 'Удачі. (Піти)', next: null, effects: [{ affinity: -5 }] },
      ],
      [{ flag: 'met' }],
    ),
    t_situation: node(
      't_situation',
      '«Двоє, може троє. Рейдери. Вони чекають, поки я вилізу. Вдвох ми їх обійдемо — один шумить, другий працює. Я вмію працювати, повір.»',
      [
        { text: 'Добре. Йдемо разом.', next: 't_join', effects: [{ joinNow: true }, { flag: 'rescued' }, { affinity: 10 }] },
        { text: 'Іди до депо, до Миколи. Там безпечно.', next: 't_bye_base', effects: [{ flag: 'rescued' }, { flag: 'at_base' }, { affinity: 6 }] },
        { text: 'Сам розберешся.', next: null, effects: [{ affinity: -6 }] },
      ],
    ),
    t_thanks: node('t_thanks', 'Він їсть швидко, по-солдатськи, і ховає обгортку в кишеню.\n\n«Дякую. Я не забуваю таких речей. Ну що, виходимо звідси?»', [
      { text: 'Виходимо разом.', next: 't_join', effects: [{ joinNow: true }, { flag: 'rescued' }, { affinity: 6 }] },
      { text: 'Йди до депо. Скажи Миколі, що я послав.', next: 't_bye_base', effects: [{ flag: 'rescued' }, { flag: 'at_base' }] },
    ]),
    t_join: node('t_join', '«Я тримаю дистанцію і прикриваю. Ти йдеш першим, але не біжи — на бігу ти мішень. Знайдеш патрони 7.62x54 — не жмоться.»', [{ text: 'Зрозумів.', next: null }]),
    t_bye_base: node('t_bye_base', '«Депо. Миколу знаю, він мені колись карбюратор перебирав. Дійду.»', [bye('Обережно там.')]),
    t_robbed: node('t_robbed', 'Тарас повільно кладе гвинтівку й висипає кишені. Дивиться тобі в очі, не кліпаючи.\n\n«Я запам\'ятаю твоє обличчя.»', [{ text: '(Забрати гроші)', next: null, effects: [{ money: 4000 }] }]),
    t_raid_again: node('t_raid_again', '«Знову ти. Тут тісно для двох — але для двох і безпечніше.»', [
      { text: 'Ходімо разом до виходу.', next: 't_join', cond: { minAffinity: 5 }, effects: [{ joinNow: true }, { flag: 'rescued' }] },
      bye('Бувай.'),
    ]),
    t_raid_comp: node('t_raid_comp', 'Тарас не відводить очей від прицілу. «Чисто. Поки що.»', [
      { text: 'Як ти?', next: 't_comp_how' },
      bye('Рухаємось.'),
    ]),
    t_comp_how: node('t_comp_how', '«Ноги ходять, руки тримають. На кордоні було гірше — там ще й бюрократія.»', [bye('Ха. Пішли.')]),
    t_base_intro: node(
      't_base_intro',
      '«Отже, табір. Микола каже, ти тут головний по вилазках. Я не люблю бути в боргу. Коли захочеш, щоб хтось прикривав тобі спину з відстані — кликни.»',
      [{ text: 'Розкажи про себе.', next: 't_past', effects: [{ affinity: 5 }] }, { text: 'Домовились.', next: 't_hub' }],
      [{ flag: 'base_intro' }],
    ),
    t_past: node('t_past', '«Прикордонний загін, Волинь. Коли прийшов Попіл, наказ був тримати пост. Тримали. Тиждень. Потім тримати стало нікому. Я пішов на схід, бо вдома вже нікого.»', [
      { text: 'Мені шкода.', next: 't_hub', effects: [{ affinity: 3 }] },
      { text: 'Тепер твій пост тут.', next: 't_hub', effects: [{ affinity: 6 }] },
    ]),
    t_hub: node('t_hub', 'Тарас чистить затвор, не дивлячись на тебе. «Слухаю.»', [
      { text: 'Тобі щось потрібно?', next: 't_quest', cond: { notFlag: ['q_scope_active', 'q_scope_done'] } },
      { text: '[4x приціл] Ось оптика.', next: 't_quest_done', cond: { flag: 'q_scope_active', hasItem: { def: 'scope_4x' } }, effects: [{ take: { def: 'scope_4x' } }, { affinity: 15 }, { unflag: 'q_scope_active' }, { flag: 'q_scope_done' }, { give: { def: 'a_54r7n1', n: 40 } }] },
      { text: 'Підеш зі мною в рейд?', next: 't_recruit', cond: { minAffinity: 25, companion: false } },
      { text: 'Цього разу залишся.', next: 't_dismiss', cond: { companion: true }, effects: [{ dismiss: true }] },
      bye(),
    ]),
    t_quest: node('t_quest', '«Моя оптика розбилась ще на кордоні. Знайди 4-кратний приціл — у військових ящиках бувають. Віддячу набоями 7Н1, вони пробивають усе, що рухається.»', [
      { text: 'Шукатиму.', next: 't_hub', effects: [{ flag: 'q_scope_active' }] },
    ]),
    t_quest_done: node('t_quest_done', 'Він довго роздивляється приціл на світло і вперше усміхається по-справжньому.\n\n«Тепер я знову бачу. Тримай набої. Чесний обмін.»', [{ text: 'Чесний.', next: 't_hub' }]),
    t_recruit: node('t_recruit', '«Беру гвинтівку. Ти — ноги, я — очі. Не відходь від мене далі, ніж на сорок метрів.»', [
      { text: 'Домовились.', next: 't_hub', effects: [{ recruit: true }, { affinity: 3 }] },
    ]),
    t_dismiss: node('t_dismiss', '«Як скажеш. Я подивлюсь за табором.»', [{ text: 'Дякую.', next: 't_hub' }]),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Ярина — студентка-радіоаматорка. Ховається на складах і в магазинах зі своєю рацією.
// ─────────────────────────────────────────────────────────────────────────────
const yaryna: NpcDef = {
  id: 'yaryna',
  name: 'Ярина',
  role: 'Radio tinkerer',
  bio: 'Третій курс радіотехнічного. Може зібрати рацію з двох калькуляторів і злості.',
  color: '#c98ad6',
  canRecruit: true,
  romanceable: true,
  home: 'raid',
  prefers: ['warehouse', 'shop', 'apartment'],
  entries: [
    { cond: { inRaid: true, companion: true }, node: 'y_raid_comp' },
    { cond: { inRaid: true, notFlag: 'met' }, node: 'y_meet' },
    { cond: { inRaid: true }, node: 'y_raid_again' },
    { cond: { notFlag: 'base_intro' }, node: 'y_base_intro' },
    { cond: { flag: 'romance' }, node: 'y_partner' },
    { node: 'y_hub' },
  ],
  nodes: {
    y_meet: node(
      'y_meet',
      'Між стелажами сидить дівчина в завеликій куртці, обіймаючи стару рацію. Побачивши тебе, вона здригається і шепоче:\n\n«Тихіше! Вони чують усе… Я Ярина. Я ловлю сигнал. Хтось передає з півночі. Кожну ніч. Ти чуєш? Хтось живий.»',
      [
        { text: 'Хто передає? Що кажуть?', next: 'y_signal', effects: [{ affinity: 6 }] },
        { text: '[Вода] На, попий. Ти бліда.', next: 'y_thanks', cond: { hasItem: { def: 'water' } }, effects: [{ take: { def: 'water' } }, { healNpc: true }, { affinity: 15 }, { flag: 'helped' }] },
        { text: '[Сік] Тримай сік.', next: 'y_thanks', cond: { hasItem: { def: 'juice' } }, effects: [{ take: { def: 'juice' } }, { healNpc: true }, { affinity: 15 }, { flag: 'helped' }] },
        { text: 'Давай сюди рацію.', next: 'y_robbed', effects: [{ affinity: -40 }, { flag: 'robbed' }] },
        { text: 'Не моя справа.', next: null, effects: [{ affinity: -6 }] },
      ],
      [{ flag: 'met' }],
    ),
    y_signal: node('y_signal', '«Цифри. Потім координати. Потім — „ми тут, ми тримаємося“. Я записую все в зошит. Але мені треба вибратись звідси, батарея сідає, а ці… інфіковані… вони йдуть на звук.»', [
      { text: 'Ходімо зі мною. Виведу.', next: 'y_join', effects: [{ joinNow: true }, { flag: 'rescued' }, { affinity: 10 }] },
      { text: 'Іди до депо. Там є генератор, підзарядиш рацію.', next: 'y_bye_base', effects: [{ flag: 'rescued' }, { flag: 'at_base' }, { affinity: 8 }] },
    ]),
    y_thanks: node('y_thanks', '«Дякую… Я тут третій день. Думала, розучилась говорити з живими людьми.»', [
      { text: 'Ходімо разом.', next: 'y_join', effects: [{ joinNow: true }, { flag: 'rescued' }, { affinity: 6 }] },
      { text: 'Йди до депо, до Миколи.', next: 'y_bye_base', effects: [{ flag: 'rescued' }, { flag: 'at_base' }] },
    ]),
    y_join: node('y_join', '«Я тримаюсь за тобою. Стріляю погано, але голосно. Це теж допомога, правда?»', [{ text: 'Ще й яка.', next: null }]),
    y_bye_base: node('y_bye_base', '«Генератор?! Я там буду раніше за тебе.»', [bye('Біжи.')]),
    y_robbed: node('y_robbed', 'Вона віддає рацію, і її руки трусяться. «Це… це все, що в мене було.»', [{ text: '(Забрати й піти)', next: null, effects: [{ give: { def: 'flash' } }] }]),
    y_raid_again: node('y_raid_again', '«Ти! Сигнал знову був сьогодні вночі. Ходімо звідси?»', [
      { text: 'Ходімо.', next: 'y_join', cond: { minAffinity: 5 }, effects: [{ joinNow: true }, { flag: 'rescued' }] },
      bye('Пізніше.'),
    ]),
    y_raid_comp: node('y_raid_comp', '«Я тут! Я поруч! …Пробач, я голосно. Я тут.»', [{ text: 'Все добре. Йдемо.', next: null }]),
    y_base_intro: node(
      'y_base_intro',
      'Ярина вже розклала на столі рацію, паяльник і половину генератора Миколи. Він дивиться на це з жахом і гордістю одночасно.\n\n«Я майже налаштувала антену! Якщо дістанеш мені плату — справжню, з відеокарти — я зможу декодувати те, що вони передають.»',
      [
        { text: 'Відеокарту? Пошукаю.', next: 'y_hub', effects: [{ flag: 'q_gpu_active' }, { affinity: 5 }] },
        { text: 'Розкажи про себе.', next: 'y_past', effects: [{ affinity: 4 }] },
      ],
      [{ flag: 'base_intro' }],
    ),
    y_past: node('y_past', '«Я з Харкова. Батьки… не знаю. Я була в гуртожитку, коли все почалось. Рація — це татова. Він казав: „Поки є сигнал — є надія.“ От я й шукаю сигнал.»', [
      { text: 'Ми знайдемо їх.', next: 'y_hub', effects: [{ affinity: 6 }] },
      { text: 'Твій тато був мудрою людиною.', next: 'y_hub', effects: [{ affinity: 4 }] },
    ]),
    y_hub: node('y_hub', 'Ярина крутить ручку налаштування. З динаміка — шипіння. «Га? Що?»', [
      { text: 'Що тобі потрібно для рації?', next: 'y_quest', cond: { notFlag: ['q_gpu_active', 'q_gpu_done'] } },
      { text: '[Відеокарта] Ось плата.', next: 'y_quest_done', cond: { flag: 'q_gpu_active', hasItem: { def: 'gpu' } }, effects: [{ take: { def: 'gpu' } }, { affinity: 18 }, { unflag: 'q_gpu_active' }, { flag: 'q_gpu_done' }, { money: 90000 }, { give: { def: 'intel' } }] },
      { text: 'Підеш зі мною в рейд?', next: 'y_recruit', cond: { minAffinity: 25, companion: false } },
      { text: 'Залишся на базі цього разу.', next: 'y_dismiss', cond: { companion: true }, effects: [{ dismiss: true }] },
      { text: 'Ярино… ти мені подобаєшся.', next: 'y_romance', cond: { stage: ['close'], notFlag: 'romance_no' }, once: true },
      bye(),
    ]),
    y_quest: node('y_quest', '«Відеокарта! З неї можна зняти чип для декодування. Шукай у квартирах і в офісах.»', [
      { text: 'Шукатиму.', next: 'y_hub', effects: [{ flag: 'q_gpu_active' }] },
    ]),
    y_quest_done: node('y_quest_done', 'Ярина три години сидить з паяльником. Потім кричить на весь табір:\n\n«ЄСТЬ! Це координати складу! Тримай теку з записами і гроші — я продала Вірі схему декодера!»', [{ text: 'Ти геній.', next: 'y_hub' }]),
    y_recruit: node('y_recruit', '«Справді?! Я візьму рацію… і пістолет-кулемет. Я тренувалась! На банках.»', [
      { text: 'На банках — це вже щось.', next: 'y_hub', effects: [{ recruit: true }, { affinity: 3 }] },
    ]),
    y_dismiss: node('y_dismiss', '«Гаразд. Я послухаю ефір. Повертайся!»', [{ text: 'Повернусь.', next: 'y_hub' }]),
    y_romance: node('y_romance', 'Вона вимикає рацію. Вперше в таборі стає зовсім тихо.\n\n«…Повтори. Я хочу бути певна, що це не перешкоди.»', [
      { text: 'Ти мені подобаєшся, Ярино.', next: 'y_romance_yes', effects: [{ flag: 'romance' }, { affinity: 15 }] },
      { text: 'Ти мені як сестра.', next: 'y_hub', effects: [{ flag: 'romance_no' }, { affinity: 4 }] },
    ]),
    y_romance_yes: node('y_romance_yes', '«Прийом. Сигнал чистий.» Вона червоніє і сміється. «Ти теж мені. Давно.»', [{ text: '(Обійняти її)', next: null, effects: [{ affinity: 5 }] }]),
    y_partner: node('y_partner', 'Ярина надягає тобі на голову навушники. «Послухай — це вони. Живі. Ми колись туди дійдемо. Разом.»', [
      { text: 'Підеш зі мною?', next: 'y_recruit', cond: { companion: false } },
      { text: 'Поговорімо.', next: 'y_hub' },
      bye('Скоро повернусь.'),
    ]),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Остап — лісник із Соснової Улоговини. Мисливець, голодний, але гордий.
// ─────────────────────────────────────────────────────────────────────────────
const ostap: NpcDef = {
  id: 'ostap',
  name: 'Остап',
  role: 'Forester · hunter',
  bio: 'Сорок років у лісі. Знає кожну стежку і кожну пастку. Людей недолюблює, собак любить.',
  color: '#c9955a',
  canRecruit: true,
  romanceable: false,
  home: 'raid',
  prefers: ['cabin', 'barn', 'house'],
  entries: [
    { cond: { inRaid: true, companion: true }, node: 'o_raid_comp' },
    { cond: { inRaid: true, notFlag: 'met' }, node: 'o_meet' },
    { cond: { inRaid: true }, node: 'o_raid_again' },
    { cond: { notFlag: 'base_intro' }, node: 'o_base_intro' },
    { node: 'o_hub' },
  ],
  nodes: {
    o_meet: node(
      'o_meet',
      'Біля холодної печі сидить кремезний дід із рушницею на колінах. Не встає.\n\n«Ходиш тихо. Це добре. Але від тебе пахне містом. Я Остап. Якщо прийшов грабувати — тут нічого нема, крім мене і голоду.»',
      [
        { text: '[Тушонка] Ось, поїжте.', next: 'o_thanks', cond: { hasItem: { def: 'tushonka' } }, effects: [{ take: { def: 'tushonka' } }, { healNpc: true }, { affinity: 22 }, { flag: 'helped' }] },
        { text: '[Сухарі] Небагато, але від душі.', next: 'o_thanks', cond: { hasItem: { def: 'crackers' } }, effects: [{ take: { def: 'crackers' } }, { healNpc: true }, { affinity: 12 }, { flag: 'helped' }] },
        { text: 'Я не грабую. Чим можу допомогти?', next: 'o_story', effects: [{ affinity: 5 }] },
        { text: 'Рушницю — мені.', next: 'o_robbed', effects: [{ affinity: -50 }, { flag: 'robbed' }] },
        { text: '(Піти)', next: null },
      ],
      [{ flag: 'met' }],
    ),
    o_story: node('o_story', '«Ліс змінився. Звірі тікають, а замість них ходять… оті. Я три дні не полював — набоїв два, а їх десяток. Як принесеш їжі — розкажу, де в лісі сховки. Я їх сам робив.»', [
      { text: 'Ходіть зі мною. Удвох прорвемось.', next: 'o_join', cond: { minAffinity: 5 }, effects: [{ joinNow: true }, { flag: 'rescued' }] },
      { text: 'Ідіть до депо. Там є їжа і люди.', next: 'o_bye_base', effects: [{ flag: 'rescued' }, { flag: 'at_base' }, { affinity: 6 }] },
      bye('Бережіть себе.'),
    ]),
    o_thanks: node('o_thanks', 'Остап їсть повільно, з повагою до їжі.\n\n«Добра в тебе душа, міський. Сховки мої — під вивернутими коренями, біля струмків. Шукай. А тепер — веди, якщо треба. Я за тобою.»', [
      { text: 'Ходімо разом.', next: 'o_join', effects: [{ joinNow: true }, { flag: 'rescued' }, { affinity: 6 }] },
      { text: 'Ідіть до депо, до Миколи.', next: 'o_bye_base', effects: [{ flag: 'rescued' }, { flag: 'at_base' }] },
    ]),
    o_join: node('o_join', '«Рушниця б\'є недалеко, але як б\'є — то наповал. Підпускай ближче.»', [{ text: 'Підпущу.', next: null }]),
    o_bye_base: node('o_bye_base', '«Депо… Колись там тепловози ремонтували. Дійду, не вперше.»', [bye('До зустрічі.')]),
    o_robbed: node('o_robbed', 'Дід віддає рушницю і відвертається до печі.\n\n«Бог тобі суддя, хлопче.»', [{ text: '(Забрати)', next: null, effects: [{ give: { def: 'a_12buck', n: 2 } }] }]),
    o_raid_again: node('o_raid_again', '«А, міський. Знову по лісах блукаєш?»', [
      { text: 'Ходімо разом.', next: 'o_join', cond: { minAffinity: 5 }, effects: [{ joinNow: true }, { flag: 'rescued' }] },
      bye('Бувайте.'),
    ]),
    o_raid_comp: node('o_raid_comp', '«Тихо… Чуєш? Там, у кущах. Не біжи.»', [{ text: 'Чую.', next: null }]),
    o_base_intro: node(
      'o_base_intro',
      '«Тут гамірно. Але тепло. Микола каже, ти тут головний. Я не люблю людей, але тебе — терплю. Це багато.»',
      [{ text: 'Розкажіть про ліс.', next: 'o_past', effects: [{ affinity: 5 }] }, { text: 'Ласкаво просимо.', next: 'o_hub' }],
      [{ flag: 'base_intro' }],
    ),
    o_past: node('o_past', '«Сорок років я знав, де лисиця, де кабан, де гриб. Тепер у лісі ходять люди, що вже не люди. І я не знаю, як їм дати раду. Але стріляти — знаю.»', [
      { text: 'Нам знадобиться ваш досвід.', next: 'o_hub', effects: [{ affinity: 4 }] },
    ]),
    o_hub: node('o_hub', 'Остап стругає ножем палицю. «Ну?»', [
      { text: 'Вам щось потрібно?', next: 'o_quest', cond: { notFlag: ['q_stew_active', 'q_stew_done'] } },
      { text: '[2× тушонка] Ось запас.', next: 'o_quest_done', cond: { flag: 'q_stew_active', hasItem: { def: 'tushonka', n: 2 } }, effects: [{ take: { def: 'tushonka', n: 2 } }, { affinity: 15 }, { unflag: 'q_stew_active' }, { flag: 'q_stew_done' }, { give: { def: 'a_12slug', n: 20 } }, { give: { def: 'saiga12' } }] },
      { text: 'Підете зі мною в рейд?', next: 'o_recruit', cond: { minAffinity: 25, companion: false } },
      { text: 'Залиштесь цього разу.', next: 'o_dismiss', cond: { companion: true }, effects: [{ dismiss: true }] },
      bye(),
    ]),
    o_quest: node('o_quest', '«Зима йде. Принеси дві банки тушонки — і я віддам тобі свою стару „Сайгу“ та кулі до неї. Мені вона вже важка.»', [
      { text: 'Принесу.', next: 'o_hub', effects: [{ flag: 'q_stew_active' }] },
    ]),
    o_quest_done: node('o_quest_done', '«Оце запас! Тримай „Сайгу“. Бережи її — вона мене двічі від ведмедя врятувала.»', [{ text: 'Берегтиму.', next: 'o_hub' }]),
    o_recruit: node('o_recruit', '«Добре. Але йдемо тихо і без дурниць.»', [
      { text: 'Тихо і без дурниць.', next: 'o_hub', effects: [{ recruit: true }, { affinity: 3 }] },
    ]),
    o_dismiss: node('o_dismiss', '«І правильно. Хтось має пильнувати табір.»', [{ text: 'Дякую.', next: 'o_hub' }]),
  },
};

export const NPCS: Record<string, NpcDef> = { lena, mykola, vera, taras, yaryna, ostap };

export function npcAtHideout(npc: NpcDef, rel: Relationship): boolean {
  if (rel.dead) return false;
  return npc.home === 'hideout' || rel.flags.includes('at_base');
}

export function npcEncounterEligible(npc: NpcDef, rel: Relationship): boolean {
  return npc.home === 'raid' && !rel.dead && !rel.flags.includes('at_base');
}

/** Initial relationship values: Mykola is an old friend. */
export const INITIAL_AFFINITY: Record<string, number> = { mykola: 40, lena: 0, vera: 0, taras: 0, yaryna: 0, ostap: 0 };
