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
      '«Отже, це і є ваш „табір\". Микола напоїв мене чаєм із чогось, що він називає чаєм. Я жива. Дякую тобі за це.»',
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

export const NPCS: Record<string, NpcDef> = { lena, mykola, vera };

export function npcAtHideout(npc: NpcDef, rel: Relationship): boolean {
  if (rel.dead) return false;
  return npc.home === 'hideout' || rel.flags.includes('at_base');
}

export function npcEncounterEligible(npc: NpcDef, rel: Relationship): boolean {
  return npc.home === 'raid' && !rel.dead && !rel.flags.includes('at_base');
}

/** Initial relationship values: Mykola is an old friend. */
export const INITIAL_AFFINITY: Record<string, number> = { mykola: 40, lena: 0, vera: 0 };
