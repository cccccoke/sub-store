/**
 * Sub-Store File Script — build Stash policy groups from injected proxies.
 *
 * Expected File operation order:
 *   1. Load files/stash-base-config.yaml.
 *   2. Use Sub-Store's official "从订阅添加节点" operation in replace mode.
 *   3. Run this script to build and validate policy groups.
 *
 * The script deliberately does not call produceArtifact() and therefore does
 * not depend on a hard-coded collection name. TCP and QUIC transports are kept
 * in separate automatic pools because an HTTP latency sample cannot represent
 * real throughput or UDP quality on mainland networks. Identity-sensitive AI
 * traffic uses only explicitly marked fixed exits and never changes IP unless
 * the user selects the clearly named emergency entry.
 */
const TEST_INTERVAL = 600;
const TCP_POOL_LIMIT = 12;
const QUIC_POOL_LIMIT = 12;
const REGION_POOL_LIMIT = 8;
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
const AI_REGION_PRIORITY = [
  'US',
  'TW',
  'JP',
  ...REGION_PRIORITY.filter(region => !['US', 'TW', 'JP'].includes(region)),
];
const AUTOMATIC_REGIONS = new Set(['HK', 'SG', 'JP', 'TW', 'US', 'KR']);
const PROTOCOL_PRIORITY = [
  'VLESS',
  'SS',
  'TROJAN',
  'ANYTLS',
  'HY2',
  'HYSTERIA2',
  'TUIC',
  'VMESS',
  'SNELL',
];

const QURE_ICON_BASE =
  'https://cdn.jsdelivr.net/gh/Koolson/Qure@b16b260625f873266f6a6a9b88710132774997b8/IconSet/Color';
const TWEMOJI_FLAG_BASE =
  'https://cdn.jsdelivr.net/gh/jdecked/twemoji@v17.0.3/assets/72x72';
const ICONS = {
  global: `${QURE_ICON_BASE}/Global.png`,
  defaultProxy: `${QURE_ICON_BASE}/Proxy.png`,
  developer: `${QURE_ICON_BASE}/GitHub.png`,
  download: `${QURE_ICON_BASE}/GitHub.png`,
  ai: `${QURE_ICON_BASE}/AI.png`,
  reliable: `${QURE_ICON_BASE}/Auto.png`,
  fast: `${QURE_ICON_BASE}/Auto.png`,
  quic: `${QURE_ICON_BASE}/Auto.png`,
  fixed: `${QURE_ICON_BASE}/Static.png`,
  ipv6: `${QURE_ICON_BASE}/LinkCube.png`,
  regions: `${QURE_ICON_BASE}/World_Map.png`,
  manual: `${QURE_ICON_BASE}/Proxy.png`,
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
  { type = 'url-test', lazy = true, icon = '' } = {},
) {
  const members = unique(proxies);
  if (!members.length) {
    throw new Error(`策略组 ${name} 不能为空；Stash 会把空组当作 DIRECT`);
  }
  return {
    name,
    type,
    proxies: members,
    interval: TEST_INTERVAL,
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
    stableId: match[6],
  };
}

const TYPE_TO_PROTOCOL = {
  ss: 'SS',
  shadowsocks: 'SS',
  vless: 'VLESS',
  hysteria2: 'HY2',
  tuic: 'TUIC',
  trojan: 'TROJAN',
  vmess: 'VMESS',
  snell: 'SNELL',
  anytls: 'ANYTLS',
};

function verifyProxyProtocol(proxy, meta) {
  const rawType = String(proxy?.type || '').toLowerCase();
  if (!rawType) throw new Error(`节点 ${proxy?.name} 缺少 type`);
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

function isNormalIPv4(meta) {
  return isKnownRegion(meta) && !meta.ipv6 && meta.lineTag !== 'FIXED';
}

function isQuic(meta) {
  return isNormalIPv4(meta) && QUIC_PROTOCOLS.has(meta.protocol);
}

function isRealityVless(record) {
  const realityOpts = record.proxy?.['reality-opts'];
  const network = String(record.proxy?.network || '').toLowerCase();
  return (
    isNormalIPv4(record.meta) &&
    record.meta.protocol === 'VLESS' &&
    (!network || network === 'tcp') &&
    realityOpts &&
    typeof realityOpts === 'object'
  );
}

function isSpecializedSS(record) {
  return (
    isNormalIPv4(record.meta) &&
    record.meta.protocol === 'SS' &&
    record.meta.lineTag === 'SPECIALIZED'
  );
}

function isReliableTcp(record) {
  return isRealityVless(record) || isSpecializedSS(record);
}

function routeTier(record) {
  const { meta } = record;
  if (meta.ipv6) return 50;
  if (meta.lineTag === 'FIXED') return 40;
  if (isRealityVless(record)) return 0;
  if (isSpecializedSS(record)) return 10;
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

    const tierRank = routeTier(left) - routeTier(right);
    if (tierRank) return tierRank;

    const protocolRank =
      priorityIndex(left.meta.protocol, PROTOCOL_PRIORITY) -
      priorityIndex(right.meta.protocol, PROTOCOL_PRIORITY);
    if (protocolRank) return protocolRank;

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
  delete cleaned['test-url'];
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
  const collidingName = groupNames.find(name => proxyNameSet.has(name));
  if (collidingName) {
    throw new Error(`节点与策略组重名: ${collidingName}`);
  }

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

function validateRuleProviders(policy) {
  const providers = policy['rule-providers'];
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new Error('Stash 模板缺少 rule-providers');
  }

  const paths = new Set();
  for (const [name, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      throw new Error(`规则集合 ${name} 配置无效`);
    }
    if (!provider.url && !provider.path) {
      throw new Error(`规则集合 ${name} 必须配置 url 或 path`);
    }
    if (provider.path) {
      if (paths.has(provider.path)) {
        throw new Error(`规则集合缓存路径重复: ${provider.path}`);
      }
      paths.add(provider.path);
    }
  }
  return new Set(Object.keys(providers));
}

function validateRules(rules, groupNameSet, proxyNames, providerNames) {
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
    if (typeof rule !== 'string') throw new Error('rules 中存在非字符串规则');
    const parts = rule.split(',').map(part => part.trim());
    if (parts.length < 2) throw new Error(`无法解析规则: ${rule}`);
    if (parts[0] === 'RULE-SET' && !providerNames.has(parts[1])) {
      throw new Error(`规则引用了不存在的规则集合 ${parts[1]}: ${rule}`);
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
const rawProxies = Array.isArray(policy.proxies) ? policy.proxies : [];

if (!rawProxies.length) {
  throw new Error(
    '文件内容中没有节点；请先添加官方“从订阅添加节点”操作，并使用替换模式',
  );
}

const rawNames = rawProxies.map(proxy => proxy?.name);
if (rawNames.some(name => !name)) throw new Error('文件内容中存在名称为空的节点');
if (new Set(rawNames).size !== rawNames.length) {
  throw new Error('文件内容中存在重名节点');
}

const proxies = rawProxies
  .map(withoutBenchmarkOverrides)
  .sort((left, right) => compareText(left.name, right.name));
const records = proxies.map(proxy => {
  const meta = parseNormalizedName(proxy.name);
  verifyProxyProtocol(proxy, meta);
  return { proxy, name: proxy.name, meta };
});
const proxyNames = namesOf(records);

const tcpPoolRecords = selectDiverseRecords(
  preferAutomaticRegions(records.filter(isReliableTcp)),
  TCP_POOL_LIMIT,
);
if (!tcpPoolRecords.length) {
  throw new Error(
    'TCP 自动池没有合格节点；至少需要一个 IPv4 VLESS/REALITY TCP 或 SS-SP 节点',
  );
}

const quicPoolRecords = selectDiverseRecords(
  preferAutomaticRegions(records.filter(record => isQuic(record.meta))),
  QUIC_POOL_LIMIT,
);

const tcpFastGroup = healthGroup('TCP Fast', namesOf(tcpPoolRecords), {
  type: 'url-test',
  lazy: false,
  icon: ICONS.fast,
});
const tcpReliableGroup = healthGroup(
  'TCP Reliable',
  namesOf(tcpPoolRecords),
  { type: 'fallback', lazy: false, icon: ICONS.reliable },
);
const quicFastGroups = quicPoolRecords.length
  ? [
      healthGroup('QUIC Fast', namesOf(quicPoolRecords), {
        type: 'url-test',
        lazy: true,
        icon: ICONS.quic,
      }),
    ]
  : [];

const regions = new Map();
const fixedByRegion = new Map();
const ipv6Records = [];
for (const record of records) {
  const { meta } = record;
  if (meta.ipv6) ipv6Records.push(record);
  if (meta.lineTag === 'FIXED') {
    addToMap(fixedByRegion, meta.region, record);
  }
  if (isNormalIPv4(meta)) addToMap(regions, meta.region, record);
}

const regionGroups = [];
const regionHelperGroups = [];
for (const [region, regionRecords] of sortedEntries(regions, REGION_PRIORITY)) {
  const regionMembers = [];
  const regionTcp = selectDiverseRecords(
    regionRecords.filter(isReliableTcp),
    REGION_POOL_LIMIT,
  );
  const regionQuic = selectDiverseRecords(
    regionRecords.filter(record => isQuic(record.meta)),
    REGION_POOL_LIMIT,
  );

  if (regionTcp.length) {
    const group = healthGroup(`${region} TCP Fast`, namesOf(regionTcp), {
      type: 'url-test',
      lazy: true,
      icon: regionIcon(region),
    });
    regionHelperGroups.push(group);
    regionMembers.push(group.name);
  }
  if (regionQuic.length) {
    const group = healthGroup(`${region} QUIC Fast`, namesOf(regionQuic), {
      type: 'url-test',
      lazy: true,
      icon: regionIcon(region),
    });
    regionHelperGroups.push(group);
    regionMembers.push(group.name);
  }

  regionGroups.push(
    selectGroup(
      region,
      [...regionMembers, ...namesOf(sortRecords(regionRecords))],
      { icon: regionIcon(region) },
    ),
  );
}

const regionalExitGroup = selectGroup(
  'Regional Exit',
  regionGroups.map(group => group.name),
  { icon: ICONS.regions },
);

const fixedGroups = sortedEntries(fixedByRegion, REGION_PRIORITY).map(
  ([region, regionRecords]) =>
    selectGroup(
      `${region} Fixed Exit`,
      namesOf(sortRecords(regionRecords)),
      { icon: ICONS.fixed },
    ),
);
const fixedParentGroups = fixedGroups.length
  ? [
      selectGroup(
        'Fixed Exit',
        fixedGroups.map(group => group.name),
        { icon: ICONS.fixed },
      ),
    ]
  : [];

const manualGroup = selectGroup('Manual', proxyNames, { icon: ICONS.manual });
const ipv6Groups = ipv6Records.length
  ? [
      selectGroup('IPv6', namesOf(sortRecords(ipv6Records)), {
        icon: ICONS.ipv6,
      }),
    ]
  : [];

if (!records.some(record => record.meta.lineTag === 'FIXED')) {
  throw new Error(
    'AI Stable 没有固定出口；请在可信固定节点名称中加入 FIXED/F 标记',
  );
}

const aiRegionGroups = sortedEntries(
  fixedByRegion,
  AI_REGION_PRIORITY,
).map(([region, regionRecords]) =>
  selectGroup(
    `AI ${region}`,
    namesOf(sortRecords(regionRecords, AI_REGION_PRIORITY)),
    { icon: regionIcon(region) },
  ),
);
const aiEmergencyGroup = selectGroup(
  'AI Emergency',
  unique([
    ...fixedParentGroups.map(group => group.name),
    'TCP Reliable',
    ...quicFastGroups.map(group => group.name),
    'Regional Exit',
    'Manual',
  ]),
  { icon: ICONS.ai },
);
const aiStableGroup = selectGroup(
  'AI Stable',
  [...aiRegionGroups.map(group => group.name), 'AI Emergency'],
  { icon: ICONS.ai },
);

const commonNavigation = unique([
  'Regional Exit',
  ...fixedParentGroups.map(group => group.name),
  ...ipv6Groups.map(group => group.name),
  'Manual',
]);
const defaultProxyGroup = selectGroup(
  'Default Proxy',
  unique([
    'TCP Fast',
    ...quicFastGroups.map(group => group.name),
    'TCP Reliable',
    ...commonNavigation,
  ]),
  { includeDirect: true, icon: ICONS.defaultProxy },
);
const developerGroup = selectGroup(
  'Developer',
  unique([
    'TCP Reliable',
    'TCP Fast',
    ...quicFastGroups.map(group => group.name),
    'Regional Exit',
    'Manual',
  ]),
  { icon: ICONS.developer },
);
const developerDownloadGroup = selectGroup(
  'Developer Download',
  unique([
    'TCP Fast',
    ...quicFastGroups.map(group => group.name),
    'TCP Reliable',
    'Regional Exit',
    'Manual',
  ]),
  { icon: ICONS.download },
);
const globalStableGroup = selectGroup(
  'Global Stable',
  [
    'Default Proxy',
    'Developer',
    'Developer Download',
    'AI Stable',
    'Regional Exit',
    'Manual',
  ],
  { includeDirect: true, icon: ICONS.global },
);

const groups = [
  globalStableGroup,
  defaultProxyGroup,
  developerGroup,
  developerDownloadGroup,
  aiStableGroup,
  ...aiRegionGroups,
  aiEmergencyGroup,
  tcpFastGroup,
  tcpReliableGroup,
  ...quicFastGroups,
  regionalExitGroup,
  ...regionGroups,
  ...regionHelperGroups,
  ...fixedParentGroups,
  ...fixedGroups,
  ...ipv6Groups,
  manualGroup,
];

const groupNameSet = validateGroupTree(groups, proxyNames);
const providerNames = validateRuleProviders(policy);
validateRules(policy.rules, groupNameSet, proxyNames, providerNames);

policy.proxies = proxies;
policy['proxy-groups'] = groups;

// The only write occurs after all validation succeeds.
$content = ProxyUtils.yaml.safeDump(policy);
