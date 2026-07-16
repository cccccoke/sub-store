/**
 * Sub-Store file script operator — Stash 4.2 mainland stability profile
 *
 * Pipeline:
 *   raw subscriptions -> normalized node names -> this script -> final Stash YAML
 *
 * Stability rules:
 *   - Stable VLESS: fixed-order fallback inside a small IPv4 REALITY pool.
 *   - Auto VLESS: latency selection over the same vetted REALITY pool.
 *   - SS-SP Backup: fixed-order specialized IPv4 SS; plain SS is excluded.
 *   - Auto QUIC: a diverse IPv4 HY2/TUIC pool kept separate from TCP.
 *   - Stable: Stable VLESS -> SS-SP Backup -> QUIC Emergency.
 *   - Home Performance: Auto VLESS -> Auto QUIC -> SS-SP Backup.
 *   - Global Stable: a curated manual entry for Stash's built-in GLOBAL
 *     selector; raw proxies and IPv6 nodes are intentionally excluded.
 *   - FIXED, V6, NONE, and plain SS nodes never enter either automatic mode.
 *   - Protocol health is checked inside small homogeneous pools; the parent
 *     fallback preserves protocol preference instead of comparing unlike
 *     transports by one HTTP latency sample.
 *   - Legacy rule targets named Auto are migrated to Default Proxy so they
 *     follow the currently selected network profile.
 *   - Stash owns DNS and benchmark settings. Per-proxy benchmark overrides are
 *     removed so the Stash 4.2 global benchmark configuration is authoritative.
 *     Nameserver and benchmark mode are not written by this script.
 *   - Validation completes before $content is replaced, so an invalid
 *     collection cannot produce an empty or partially linked policy.
 */
const COLLECTION_NAME = 'Sub-Store';
const TEST_INTERVAL = 600;
const ADAPTIVE_TEST_INTERVAL = 600;
const VLESS_POOL_LIMIT = 8;
const SS_SP_POOL_LIMIT = 6;
const QUIC_POOL_LIMIT = 12;
const QUIC_EMERGENCY_LIMIT = 4;
const STABLE_PROTOCOLS = new Set(['SS', 'VLESS']);
const QUIC_PROTOCOLS = new Set(['HY2', 'HYSTERIA2', 'TUIC']);
const REGION_PRIORITY = [
  'HK',
  'SG',
  'JP',
  'TW',
  'US',
  'KR',
  'MY',
  'TH',
  'ID',
  'RU',
  'NG',
  'NONE',
];
const AI_REGION_PRIORITY = ['US', 'JP', 'SG'];
const AUTOMATIC_REGIONS = new Set(['HK', 'SG', 'JP', 'TW', 'US', 'KR']);
const PROTOCOL_PRIORITY = [
  'VLESS',
  'HY2',
  'HYSTERIA2',
  'TUIC',
  'SS',
  'VMESS',
  'TROJAN',
  'SNELL',
];

const QURE_ICON_BASE =
  'https://cdn.jsdelivr.net/gh/Koolson/Qure@b16b260625f873266f6a6a9b88710132774997b8/IconSet/Color';
const TWEMOJI_FLAG_BASE =
  'https://cdn.jsdelivr.net/gh/jdecked/twemoji@v17.0.3/assets/72x72';
const ICONS = {
  defaultProxy: `${QURE_ICON_BASE}/Proxy.png`,
  researchAI: `${QURE_ICON_BASE}/AI.png`,
  developer: `${QURE_ICON_BASE}/GitHub.png`,
  stable: `${QURE_ICON_BASE}/Auto.png`,
  auto: `${QURE_ICON_BASE}/Auto.png`,
  specialized: `${QURE_ICON_BASE}/IPLC.png`,
  fixed: `${QURE_ICON_BASE}/Static.png`,
  ipv6: `${QURE_ICON_BASE}/LinkCube.png`,
  regions: `${QURE_ICON_BASE}/Global.png`,
  protocols: `${QURE_ICON_BASE}/Proxy.png`,
  subscriptions: `${QURE_ICON_BASE}/ssLinks.png`,
  subscription: `${QURE_ICON_BASE}/Airport.png`,
  unknownRegion: `${QURE_ICON_BASE}/World_Map.png`,
};

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function addToMap(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function priorityIndex(value, priorities) {
  const index = priorities.indexOf(value);
  return index === -1 ? priorities.length : index;
}

function sortedEntries(map, priorities = []) {
  return [...map.entries()].sort(([left], [right]) => {
    if (priorities.length) {
      const rank =
        priorityIndex(left, priorities) - priorityIndex(right, priorities);
      if (rank) return rank;
    }
    return compareText(left, right);
  });
}

function healthGroup(
  name,
  proxies,
  {
    type = 'url-test',
    lazy = true,
    interval = TEST_INTERVAL,
    icon = '',
  } = {},
) {
  const members = unique(proxies);
  if (!members.length) {
    throw new Error(`策略组 ${name} 不能为空；Stash 会把空组当作 DIRECT`);
  }
  return {
    name,
    type,
    proxies: members,
    interval,
    lazy,
    ...(icon ? { icon } : {}),
  };
}

function selectGroup(name, proxies, { includeDirect = false, icon = '' } = {}) {
  const members = unique([
    ...proxies,
    ...(includeDirect ? ['DIRECT'] : []),
  ]);
  if (!members.length) {
    throw new Error(`选择组 ${name} 不能为空；Stash 会把空组当作 DIRECT`);
  }
  return {
    name,
    type: 'select',
    proxies: members,
    ...(icon ? { icon } : {}),
  };
}

function regionIcon(region) {
  if (!/^[A-Z]{2}$/.test(region)) return ICONS.unknownRegion;

  const flagRegion = region === 'UK' ? 'GB' : region;
  const codePoints = [...flagRegion].map(letter =>
    (0x1f1e6 + letter.charCodeAt(0) - 65).toString(16),
  );
  return `${TWEMOJI_FLAG_BASE}/${codePoints.join('-')}.png`;
}

function parseNormalizedName(name) {
  const source = String(name || '');
  const match = source.match(
    /^([A-Z0-9._:]+)-([A-Z]{2}|NONE)-([A-Z0-9._:]+)(?:-(F|FIXED|SP|SPECIALIZED))?(?:-(V6|IPV6))?-(\d+)$/,
  );

  if (!match) {
    throw new Error(
      `节点名称不符合 SUB-REGION-PROTOCOL-[F/SP]-[V6]-NN 规范: ${source}`,
    );
  }

  const rawLineTag = match[4] || '';
  return {
    subscription: match[1],
    region: match[2],
    protocol: match[3],
    lineTag: /^(?:F|FIXED)$/.test(rawLineTag)
      ? 'FIXED'
      : /^(?:SP|SPECIALIZED)$/.test(rawLineTag)
        ? 'SPECIALIZED'
        : '',
    ipv6: /^(?:V6|IPV6)$/.test(match[5] || ''),
    index: Number(match[6]),
  };
}

const TYPE_TO_PROTOCOL = {
  ss: 'SS',
  shadowsocks: 'SS',
  vless: 'VLESS',
  hysteria2: 'HY2',
  tuic: 'TUIC',
};

function verifyProxyProtocol(proxy, meta) {
  const rawType = String(proxy && proxy.type || '').toLowerCase();
  if (!rawType) {
    throw new Error(`节点 ${proxy && proxy.name} 缺少 type`);
  }

  const expectedProtocol = TYPE_TO_PROTOCOL[rawType];
  if (expectedProtocol && expectedProtocol !== meta.protocol) {
    throw new Error(
      `节点 ${proxy.name} 的名称协议为 ${meta.protocol}，实际 type 为 ${rawType}`,
    );
  }
}

function isKnownRegion(meta) {
  return meta.region !== 'NONE';
}

function isSafeIPv4(meta) {
  return isKnownRegion(meta) && !meta.ipv6 && meta.lineTag !== 'FIXED';
}

function isQuic(meta) {
  return isSafeIPv4(meta) && QUIC_PROTOCOLS.has(meta.protocol);
}

function isVless(meta) {
  return isSafeIPv4(meta) && meta.protocol === 'VLESS';
}

function isRealityVless(record) {
  const realityOpts = record.proxy && record.proxy['reality-opts'];
  const network = String(record.proxy.network || '').toLowerCase();
  return (
    isVless(record.meta) &&
    (!network || network === 'tcp') &&
    realityOpts &&
    typeof realityOpts === 'object'
  );
}

function isSpecializedSS(meta) {
  return (
    isSafeIPv4(meta) &&
    meta.protocol === 'SS' &&
    meta.lineTag === 'SPECIALIZED'
  );
}

function routeTier(meta) {
  if (meta.ipv6) return 50;
  if (meta.lineTag === 'FIXED') return 40;
  if (meta.protocol === 'VLESS') return 0;
  if (meta.lineTag === 'SPECIALIZED' && meta.protocol === 'SS') return 10;
  if (QUIC_PROTOCOLS.has(meta.protocol)) return 20;
  if (meta.protocol === 'SS') return 30;
  return 35;
}

function sortRecords(records, regionPriorities = REGION_PRIORITY) {
  return [...records].sort((left, right) => {
    const regionRank =
      priorityIndex(left.meta.region, regionPriorities) -
      priorityIndex(right.meta.region, regionPriorities);
    if (regionRank) return regionRank;

    const tierRank = routeTier(left.meta) - routeTier(right.meta);
    if (tierRank) return tierRank;

    const protocolRank =
      priorityIndex(left.meta.protocol, PROTOCOL_PRIORITY) -
      priorityIndex(right.meta.protocol, PROTOCOL_PRIORITY);
    if (protocolRank) return protocolRank;

    return compareText(left.name, right.name);
  });
}

function sortAIRecords(records) {
  return [...records].sort((left, right) => {
    const fixedRank =
      Number(right.meta.lineTag === 'FIXED') -
      Number(left.meta.lineTag === 'FIXED');
    if (fixedRank) return fixedRank;

    const tierRank = routeTier(left.meta) - routeTier(right.meta);
    if (tierRank) return tierRank;

    const regionRank =
      priorityIndex(left.meta.region, AI_REGION_PRIORITY) -
      priorityIndex(right.meta.region, AI_REGION_PRIORITY);
    if (regionRank) return regionRank;

    return compareText(left.name, right.name);
  });
}

function namesOf(records) {
  return records.map(record => record.name);
}

function withoutBenchmarkOverrides(proxy) {
  const cleaned = { ...proxy };
  delete cleaned['benchmark-url'];
  delete cleaned['benchmark-timeout'];
  delete cleaned['benchmark-disabled'];
  return cleaned;
}

function selectDiverseRecords(records, limit) {
  const buckets = new Map();

  for (const record of sortRecords(records)) {
    const key = [
      record.meta.subscription,
      record.meta.region,
      record.meta.protocol,
    ].join('\u0000');
    addToMap(buckets, key, record);
  }

  const orderedBuckets = [...buckets.values()];
  const selected = [];

  for (let round = 0; selected.length < limit; round += 1) {
    let added = false;
    for (const bucket of orderedBuckets) {
      if (round >= bucket.length) continue;
      selected.push(bucket[round]);
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }

  return selected;
}

function preferAutomaticRegions(records) {
  const preferred = records.filter(record =>
    AUTOMATIC_REGIONS.has(record.meta.region),
  );
  return preferred.length ? preferred : records;
}

function validateGroupTree(groups, proxyNames) {
  const groupNames = groups.map(group => group.name);
  if (new Set(groupNames).size !== groupNames.length) {
    throw new Error('生成结果存在重名策略组');
  }

  const proxyNameSet = new Set(proxyNames);
  const groupNameSet = new Set(groupNames);
  const builtIns = new Set([
    'DIRECT',
    'REJECT',
    'REJECT-DROP',
    'PASS',
    'COMPATIBLE',
  ]);

  for (const group of groups) {
    if (!Array.isArray(group.proxies) || !group.proxies.length) {
      throw new Error(`策略组 ${group.name} 没有成员`);
    }
    if (new Set(group.proxies).size !== group.proxies.length) {
      throw new Error(`策略组 ${group.name} 存在重复成员`);
    }
    if (group.proxies.includes(group.name)) {
      throw new Error(`策略组 ${group.name} 发生自引用`);
    }

    for (const member of group.proxies) {
      if (
        !proxyNameSet.has(member) &&
        !groupNameSet.has(member) &&
        !builtIns.has(member)
      ) {
        throw new Error(`策略组 ${group.name} 引用了不存在的成员 ${member}`);
      }
    }
  }

  const edges = new Map(
    groups.map(group => [
      group.name,
      group.proxies.filter(member => groupNameSet.has(member)),
    ]),
  );
  const state = new Map();

  function visit(name, trail) {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) {
      throw new Error(`策略组发生循环引用: ${[...trail, name].join(' -> ')}`);
    }

    state.set(name, 1);
    for (const child of edges.get(name) || []) {
      visit(child, [...trail, name]);
    }
    state.set(name, 2);
  }

  for (const name of groupNames) visit(name, []);
  return groupNameSet;
}

function migrateLegacyRuleTargets(rules) {
  if (!Array.isArray(rules)) return rules;

  return rules.map(rule => {
    if (typeof rule !== 'string') return rule;
    const parts = rule.split(',');
    const lastIndex = parts.length - 1;
    const targetIndex =
      String(parts[lastIndex] || '').trim().toLowerCase() === 'no-resolve'
        ? lastIndex - 1
        : lastIndex;

    if (String(parts[targetIndex] || '').trim() === 'Auto') {
      parts[targetIndex] = 'Default Proxy';
    }
    return parts.join(',');
  });
}

function validateRules(rules, groupNameSet, proxyNames) {
  if (!Array.isArray(rules) || !rules.length) {
    throw new Error('Stash 模板缺少 rules');
  }
  if (rules[rules.length - 1] !== 'MATCH,Default Proxy') {
    throw new Error('Stash 模板的最后一条规则必须是 MATCH,Default Proxy');
  }

  const validTargets = new Set([
    ...groupNameSet,
    ...proxyNames,
    'DIRECT',
    'REJECT',
    'REJECT-DROP',
    'PASS',
    'COMPATIBLE',
  ]);

  for (const rule of rules) {
    if (typeof rule !== 'string') {
      throw new Error('rules 中存在非字符串规则');
    }
    const parts = rule.split(',').map(part => part.trim());
    if (parts.length < 2) {
      throw new Error(`无法解析规则: ${rule}`);
    }
    const last = parts[parts.length - 1].toLowerCase();
    const target =
      last === 'no-resolve' ? parts[parts.length - 2] : parts[parts.length - 1];
    if (!validTargets.has(target)) {
      throw new Error(`规则引用了不存在的策略 ${target}: ${rule}`);
    }
  }
}

const policy = ProxyUtils.yaml.safeLoad($content) || {};
policy.rules = migrateLegacyRuleTargets(policy.rules);
const rendered = await produceArtifact({
  type: 'collection',
  name: COLLECTION_NAME,
  platform: 'Stash',
  produceOpts: { prettyYaml: true },
});
const nodeConfig = ProxyUtils.yaml.safeLoad(rendered) || {};
const rawProxies = Array.isArray(nodeConfig.proxies)
  ? nodeConfig.proxies
  : [];

if (!rawProxies.length) {
  throw new Error(`${COLLECTION_NAME} 未生成有效 Stash 节点`);
}

const rawNames = rawProxies.map(proxy => proxy && proxy.name);
if (rawNames.some(name => !name)) {
  throw new Error(`${COLLECTION_NAME} 存在名称为空的节点`);
}
if (new Set(rawNames).size !== rawNames.length) {
  throw new Error(`${COLLECTION_NAME} 存在重名节点`);
}

// Stable output order prevents harmless upstream reordering from producing a
// different final YAML.
const proxies = rawProxies
  .map(withoutBenchmarkOverrides)
  .sort((left, right) => compareText(left.name, right.name));
const records = proxies.map(proxy => {
  const meta = parseNormalizedName(proxy.name);
  verifyProxyProtocol(proxy, meta);
  return { proxy, name: proxy.name, meta };
});
const proxyNames = namesOf(records);

const quicRecords = sortRecords(records.filter(record =>
  isQuic(record.meta),
));
const realityVlessRecords = sortRecords(records.filter(isRealityVless));
const specializedSSRecords = sortRecords(records.filter(record =>
  isSpecializedSS(record.meta),
));

const autoVlessRecords = selectDiverseRecords(
  preferAutomaticRegions(realityVlessRecords),
  VLESS_POOL_LIMIT,
);
const ssBackupRecords = selectDiverseRecords(
  preferAutomaticRegions(specializedSSRecords),
  SS_SP_POOL_LIMIT,
);
const autoQuicRecords = selectDiverseRecords(
  preferAutomaticRegions(quicRecords),
  QUIC_POOL_LIMIT,
);
const emergencyQuicRecords = autoQuicRecords.slice(0, QUIC_EMERGENCY_LIMIT);

if (!autoVlessRecords.length && !ssBackupRecords.length) {
  throw new Error(
    'Stable 没有合格 TCP 节点；需要 IPv4 VLESS/REALITY 或 SS-SP',
  );
}

const regions = new Map();
const subscriptions = new Map();
const protocols = new Map();
const fixedByRegion = new Map();
const ipv6ByRegion = new Map();
const noneRecords = [];
const specializedRecords = [];

for (const record of records) {
  const { meta, name } = record;

  if (meta.lineTag === 'SPECIALIZED') specializedRecords.push(record);
  if (meta.lineTag === 'FIXED') addToMap(fixedByRegion, meta.region, record);
  if (meta.ipv6) addToMap(ipv6ByRegion, meta.region, record);
  if (meta.region === 'NONE') noneRecords.push(record);

  // Region, subscription, and protocol navigation groups are safe IPv4,
  // non-fixed pools. Dedicated/V6/NONE nodes already have explicit entries.
  if (isSafeIPv4(meta)) {
    addToMap(regions, meta.region, record);
    addToMap(subscriptions, meta.subscription, record);
    addToMap(protocols, meta.protocol, record);
  }
}

const autoVlessGroups = autoVlessRecords.length
  ? [
      healthGroup('Auto VLESS', namesOf(autoVlessRecords), {
        type: 'url-test',
        lazy: false,
        interval: ADAPTIVE_TEST_INTERVAL,
        icon: ICONS.auto,
      }),
    ]
  : [];
const stableVlessGroups = autoVlessRecords.length
  ? [
      healthGroup('Stable VLESS', namesOf(autoVlessRecords), {
        type: 'fallback',
        lazy: false,
        icon: ICONS.stable,
      }),
    ]
  : [];
const ssBackupGroups = ssBackupRecords.length
  ? [
      healthGroup('SS-SP Backup', namesOf(ssBackupRecords), {
        type: 'fallback',
        lazy: false,
        interval: ADAPTIVE_TEST_INTERVAL,
        icon: ICONS.specialized,
      }),
    ]
  : [];
const quicGroups = autoQuicRecords.length
  ? [
      healthGroup('Auto QUIC', namesOf(autoQuicRecords), {
        type: 'url-test',
        lazy: true,
        interval: ADAPTIVE_TEST_INTERVAL,
        icon: ICONS.auto,
      }),
    ]
  : [];
const quicEmergencyGroups = emergencyQuicRecords.length
  ? [
      healthGroup('QUIC Emergency', namesOf(emergencyQuicRecords), {
        type: 'fallback',
        lazy: false,
        interval: ADAPTIVE_TEST_INTERVAL,
        icon: ICONS.auto,
      }),
    ]
  : [];

const stableGroup = healthGroup(
  'Stable',
  [
    ...stableVlessGroups.map(group => group.name),
    ...ssBackupGroups.map(group => group.name),
    ...quicEmergencyGroups.map(group => group.name),
  ],
  {
    type: 'fallback',
    lazy: false,
    icon: ICONS.stable,
  },
);
const homePerformanceGroup = healthGroup(
  'Home Performance',
  [
    ...autoVlessGroups.map(group => group.name),
    ...quicGroups.map(group => group.name),
    ...ssBackupGroups.map(group => group.name),
  ],
  {
    type: 'fallback',
    lazy: false,
    interval: ADAPTIVE_TEST_INTERVAL,
    icon: ICONS.auto,
  },
);

const aiCandidates = records.filter(record =>
  AI_REGION_PRIORITY.includes(record.meta.region) &&
  (
    (record.meta.lineTag === 'FIXED' && !record.meta.ipv6) ||
    isRealityVless(record) ||
    isSpecializedSS(record.meta)
  ),
);
if (!aiCandidates.length) {
  throw new Error('AI Stable 没有 US/JP/SG 的固定 IP、VLESS/REALITY 或 SS-SP 节点');
}
const aiStableGroup = healthGroup(
  'AI Stable',
  namesOf(sortAIRecords(aiCandidates)),
  {
    type: 'fallback',
    lazy: false,
    icon: ICONS.researchAI,
  },
);

const specializedGroups = specializedRecords.length
  ? [
      healthGroup(
        'Specialized',
        namesOf(sortRecords(specializedRecords)),
        {
          type: 'fallback',
          lazy: true,
          icon: ICONS.specialized,
        },
      ),
    ]
  : [];

const fixedGroups = sortedEntries(fixedByRegion, REGION_PRIORITY).map(
  ([region, regionRecords]) =>
    healthGroup(
      `${region} Fixed IP`,
      namesOf(sortRecords(regionRecords)),
      {
        type: 'fallback',
        lazy: false,
        icon: ICONS.fixed,
      },
    ),
);

const ipv6Groups = sortedEntries(ipv6ByRegion, REGION_PRIORITY).map(
  ([region, regionRecords]) =>
    healthGroup(
      `${region} IPv6`,
      namesOf(sortRecords(regionRecords)),
      {
        type: 'url-test',
        lazy: true,
        icon: ICONS.ipv6,
      },
    ),
);

const regionGroups = sortedEntries(regions, REGION_PRIORITY).map(
  ([region, regionRecords]) =>
    healthGroup(region, namesOf(sortRecords(regionRecords)), {
      type: 'fallback',
      lazy: true,
      icon: regionIcon(region),
    }),
);
if (noneRecords.length) {
  regionGroups.push(
    healthGroup('NONE', namesOf(sortRecords(noneRecords)), {
      type: 'fallback',
      lazy: true,
      icon: ICONS.unknownRegion,
    }),
  );
}

const protocolGroups = sortedEntries(protocols, PROTOCOL_PRIORITY).map(
  ([protocol, protocolRecords]) =>
    healthGroup(
      `Protocol ${protocol}`,
      namesOf(sortRecords(protocolRecords)),
      {
        type:
          STABLE_PROTOCOLS.has(protocol) || QUIC_PROTOCOLS.has(protocol)
            ? 'url-test'
            : 'fallback',
        lazy: true,
        icon: ICONS.protocols,
      },
    ),
);

const subscriptionGroups = sortedEntries(subscriptions).map(
  ([subscription, subscriptionRecords]) =>
    healthGroup(
      `SUB-${subscription}`,
      namesOf(sortRecords(subscriptionRecords)),
      {
        type: 'fallback',
        lazy: true,
        icon: ICONS.subscription,
      },
    ),
);

const regionParent = regionGroups.length
  ? [
      selectGroup(
        'Regions',
        regionGroups.map(group => group.name),
        { icon: ICONS.regions },
      ),
    ]
  : [];
const protocolParent = protocolGroups.length
  ? [
      selectGroup(
        'Protocols',
        protocolGroups.map(group => group.name),
        { icon: ICONS.protocols },
      ),
    ]
  : [];
const fixedParent = fixedGroups.length
  ? [
      selectGroup(
        'Fixed IP',
        fixedGroups.map(group => group.name),
        { icon: ICONS.fixed },
      ),
    ]
  : [];
const ipv6Parent = ipv6Groups.length
  ? [
      selectGroup(
        'IPv6',
        ipv6Groups.map(group => group.name),
        { icon: ICONS.ipv6 },
      ),
    ]
  : [];
const subscriptionParent = subscriptionGroups.length
  ? [
      selectGroup(
        'Subscriptions',
        subscriptionGroups.map(group => group.name),
        { icon: ICONS.subscriptions },
      ),
    ]
  : [];

const navigationMembers = unique([
  ...specializedGroups.map(group => group.name),
  ...regionParent.map(group => group.name),
  ...protocolParent.map(group => group.name),
  ...fixedParent.map(group => group.name),
  ...ipv6Parent.map(group => group.name),
  ...subscriptionParent.map(group => group.name),
]);

const fixedNamesForAI = [
  'US Fixed IP',
  'JP Fixed IP',
  ...fixedGroups
    .map(group => group.name)
    .filter(name => name !== 'US Fixed IP' && name !== 'JP Fixed IP'),
].filter(name => fixedGroups.some(group => group.name === name));
const researchMembers = unique([
  'AI Stable',
  ...fixedNamesForAI,
  ...specializedGroups.map(group => group.name),
  'Stable',
  ...autoVlessGroups.map(group => group.name),
  ...ssBackupGroups.map(group => group.name),
]);

const automaticMembers = unique([
  'Stable',
  'Home Performance',
  ...autoVlessGroups.map(group => group.name),
  ...quicGroups.map(group => group.name),
  ...ssBackupGroups.map(group => group.name),
]);

const globalStableGroup = selectGroup(
  'Global Stable',
  unique([
    'Stable',
    'Home Performance',
    ...autoVlessGroups.map(group => group.name),
    ...quicGroups.map(group => group.name),
    'AI Stable',
  ]),
  { includeDirect: true, icon: ICONS.stable },
);

const groups = [
  globalStableGroup,
  selectGroup(
    'Default Proxy',
    [...automaticMembers, ...navigationMembers],
    { includeDirect: true, icon: ICONS.defaultProxy },
  ),
  selectGroup('Research + AI', researchMembers, {
    icon: ICONS.researchAI,
  }),
  selectGroup(
    'Developer',
    [...automaticMembers, ...navigationMembers],
    { icon: ICONS.developer },
  ),
  stableGroup,
  homePerformanceGroup,
  ...stableVlessGroups,
  ...autoVlessGroups,
  ...quicGroups,
  ...ssBackupGroups,
  ...quicEmergencyGroups,
  aiStableGroup,
  ...specializedGroups,
  ...regionParent,
  ...regionGroups,
  ...protocolParent,
  ...protocolGroups,
  ...fixedParent,
  ...fixedGroups,
  ...ipv6Parent,
  ...ipv6Groups,
  ...subscriptionParent,
  ...subscriptionGroups,
];

const groupNameSet = validateGroupTree(groups, proxyNames);
validateRules(policy.rules, groupNameSet, proxyNames);

policy.proxies = proxies;
policy['proxy-groups'] = groups;

// The only write occurs after all validation succeeds.
$content = ProxyUtils.yaml.safeDump(policy);
