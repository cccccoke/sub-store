/**
 * Sub-Store collection operator: normalize names for the Stash generator.
 *
 * OUTPUT:
 * ADDRESS-REGION-PROTOCOL-[F|SP]-[V6]-STABLE_ID
 *
 * EXAMPLES:
 * KTM-HK-VLESS-F-0123456789
 * KTM-HK-SS-SP-1234567890
 * KTM-HK-HY2-2345678901
 * KTM-TW-SS-V6-3456789012
 */
async function operator(proxies = [], targetPlatform, context = {}) {
  const CONFIG = {
    // INPUT: KTM-HK-1 -> ADDRESS = KTM, NODE NAME = HK-1
    addressFromName: true,

    // REMOVE TRAFFIC, EXPIRY AND FILTER NOTICE NODES.
    dropInfoNodes: true,

    unknownAddress: 'SUBSCRIPTION',
    unknownRegion: 'NONE',
    unknownProtocol: 'UNK',
    stableIdWidth: 10,
  };

  const INFO_RE =
    /无法使用|更新订阅|重新复制订阅|登录网站|(?:剩余|已用|可用|总计?)流量|距离下次重置|下次重置剩余|套餐到期|到期时间|过期时间|有效期|过滤掉\s*\d*\s*条|已过滤\s*\d*\s*条|traffic\s*(?:left|remain)|bandwidth|quota|expir(?:e|y)/i;

  // FIXED IS DETERMINED ONLY FROM THE ORIGINAL NODE NAME.
  const FIXED_RE =
    /固定(?:IP)?|静态(?:IP)?|独享(?:IP)?|独立IP|dedicated|static\s*ip|fixed\s*ip|(?:^|[-_\s])(?:fixed|f)(?=$|[-_\s])/i;

  // SPECIALIZED LINE IDENTIFIERS. EDIT THIS REGEX IF MORE TAGS ARE NEEDED.
  const SPECIALIZED_RE =
    /专线|專線|(?:^|[^A-Z0-9])(?:IEPL|IPLC|MPLS|DIA|BGP|CN2\s*GIA|CN2|CUG|CTG|CMI|AS9929|9929|PRIVATE\s*LINE|LEASED\s*LINE|SPECIALIZED|SP)(?=$|[^A-Z0-9])/i;

  // IPV6 IS ALSO DETERMINED ONLY FROM THE ORIGINAL NODE NAME.
  const IPV6_RE =
    /(?:^|[^A-Z0-9])(?:IPV6|V6)(?=$|[^A-Z0-9])/i;

  // Explicit text wins over flags because some providers reuse incorrect
  // flag/code combinations, for example "🇨🇳 TW台湾" and "🇲🇨 MC印度尼西亚".
  const REGION_ALIASES = [
    ['HK', /香港|HONG\s*KONG/i],
    ['TW', /台湾|臺灣|TAIWAN/i],
    ['SG', /新加坡|SINGAPORE/i],
    ['JP', /日本|JAPAN/i],
    ['KR', /韩国|韓國|KOREA/i],
    ['MY', /马来西亚|馬來西亞|MALAYSIA/i],
    ['TH', /泰国|泰國|THAILAND/i],
    ['ID', /印度尼西亚|印度尼西亞|印尼|INDONESIA/i],
    ['US', /美国|美國|UNITED\s*STATES/i],
    ['RU', /俄罗斯|俄羅斯|RUSSIA/i],
    ['NG', /尼日利亚|尼日利亞|NIGERIA/i],
    ['GB', /英国|英國|UNITED\s*KINGDOM/i],
    ['CA', /加拿大|CANADA/i],
    ['AU', /澳大利亚|澳大利亞|澳洲|AUSTRALIA/i],
    ['DE', /德国|德國|GERMANY/i],
    ['FR', /法国|法國|FRANCE/i],
    ['NL', /荷兰|荷蘭|NETHERLANDS/i],
    ['IN', /印度|INDIA/i],
  ];

  const KNOWN_REGION_CODES = new Set([
    'HK', 'TW', 'SG', 'JP', 'KR', 'MY', 'TH', 'ID', 'US', 'RU', 'NG',
    'GB', 'CA', 'AU', 'DE', 'FR', 'NL', 'IN', 'PH', 'VN', 'TR', 'AE',
    'BR', 'AR', 'CL', 'MX', 'ES', 'IT', 'SE', 'NO', 'FI', 'DK', 'CH',
    'AT', 'BE', 'PL', 'CZ', 'HU', 'RO', 'PT', 'IE', 'ZA', 'NZ', 'IL',
    'UA', 'CN',
  ]);

  // Optional user-owned identity. Example: [ID:AI-US-PRIMARY]. The marker is
  // hashed before it enters the public node name, so the label is not exposed.
  const STABLE_ID_RE =
    /\[(?:ID|SID)\s*[:=]\s*([A-Z0-9._-]{1,64})\]/i;

  // KEEP PROTOCOL NAMES UPPERCASE AND DO NOT OMIT THE PROTOCOL FIELD.
  const TYPE_ALIASES = {
    ss: 'SS',
    shadowsocks: 'SS',
    ssr: 'SSR',
    shadowsocksr: 'SSR',
    vmess: 'VMESS',
    vless: 'VLESS',
    trojan: 'TROJAN',
    hysteria: 'HY',
    hysteria2: 'HY2',
    hy2: 'HY2',
    tuic: 'TUIC',
    wireguard: 'WG',
    wg: 'WG',
    socks: 'SOCKS',
    socks5: 'SOCKS5',
    http: 'HTTP',
    https: 'HTTPS',
    snell: 'SNELL',
    ssh: 'SSH',
    mieru: 'MIERU',
    anytls: 'ANYTLS',
  };

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  // OUTPUT SEGMENTS ARE ASCII, UPPERCASE AND CONTAIN NO SPACES.
  function cleanSegment(value, fallback) {
    const result = clean(value)
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9._:]/g, '');

    return result || fallback;
  }

  function isInfoNode(name) {
    return INFO_RE.test(clean(name));
  }

  /**
   * KTM-HK-1 -> { address: 'KTM', nodeName: 'HK-1' }
   */
  function splitAddress(proxy) {
    const fullName = clean(proxy.name);
    const declaredAddress = clean(
      proxy._subDisplayName || proxy._subName,
    );

    // SUB-STORE METADATA IS THE MOST RELIABLE SUBSCRIPTION ADDRESS. IT ALSO
    // MEANS THE USER DOES NOT NEED A SEPARATE `prefix-` SHORTCUT SCRIPT.
    if (declaredAddress) {
      const declaredPrefix = `${declaredAddress.toUpperCase()}-`;
      const alreadyPrefixed =
        CONFIG.addressFromName &&
        fullName.toUpperCase().startsWith(declaredPrefix);

      return {
        address: declaredAddress,
        nodeName: alreadyPrefixed
          ? fullName.slice(declaredAddress.length + 1)
          : fullName,
      };
    }

    if (CONFIG.addressFromName) {
      // FALL BACK TO PREFIX-NODE WHEN SUB-STORE METADATA IS UNAVAILABLE.
      const separatorIndex = fullName.indexOf('-');
      if (separatorIndex > 0) {
        return {
          address: fullName.slice(0, separatorIndex),
          nodeName: fullName.slice(separatorIndex + 1),
        };
      }
    }

    return {
      address: CONFIG.unknownAddress,
      nodeName: fullName,
    };
  }

  function isRegionFlag(value) {
    return /^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(value || '');
  }

  function flagToISO(flag) {
    if (!isRegionFlag(flag)) return undefined;

    return [...flag]
      .map(char =>
        String.fromCharCode(
          char.codePointAt(0) - 0x1f1e6 + 65,
        ),
      )
      .join('');
  }

  function getRegion(proxy, nodeName) {
    const name = clean(nodeName);

    for (const [region, pattern] of REGION_ALIASES) {
      if (pattern.test(name)) return region;
    }

    // SUPPORT HK2-HY2, US1-HY2, US-1TCP, USA AND UK.
    const tokens = name.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
    for (const token of tokens) {
      if (token === 'USA') return 'US';
      if (token === 'UK') return 'GB';
      if (KNOWN_REGION_CODES.has(token)) return token;
    }

    const explicitCandidates = [
      proxy.country,
      proxy.countryCode,
      proxy['country-code'],
      proxy._country,
      proxy._countryCode,
    ];

    for (const candidate of explicitCandidates) {
      const iso = clean(candidate).toUpperCase();
      if (/^[A-Z]{2}$/.test(iso)) return iso;
    }

    try {
      const iso = clean(ProxyUtils.getISO(nodeName)).toUpperCase();
      if (/^[A-Z]{2}$/.test(iso)) return iso;
    } catch (_) {}

    const flag = nodeName.match(
      /[\u{1F1E6}-\u{1F1FF}]{2}/u,
    )?.[0];
    const isoFromFlag = flagToISO(flag);
    if (isoFromFlag) return isoFromFlag;

    return CONFIG.unknownRegion;
  }

  function getProtocol(proxy, nodeName) {
    const rawType = clean(proxy.type)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

    if (rawType) {
      return TYPE_ALIASES[rawType] || rawType.toUpperCase();
    }

    // USE THE NODE NAME ONLY WHEN proxy.type IS MISSING.
    const name = clean(nodeName);
    if (/\b(?:HY2|HYSTERIA2)\b/i.test(name)) return 'HY2';
    if (/\bHYSTERIA\b|\bHY\b/i.test(name)) return 'HY';
    if (/\bVLESS\b/i.test(name)) return 'VLESS';
    if (/\bVMESS\b/i.test(name)) return 'VMESS';
    if (/\bTROJAN\b/i.test(name)) return 'TROJAN';
    if (/\bTUIC\b/i.test(name)) return 'TUIC';
    if (/\bWIREGUARD\b|\bWG\b/i.test(name)) return 'WG';
    if (/\b(?:SS|SHADOWSOCKS)\b/i.test(name)) return 'SS';

    return CONFIG.unknownProtocol;
  }

  function getLineTag(nodeName) {
    // PRIORITY: FIXED > SPECIALIZED > OMITTED.
    if (FIXED_RE.test(nodeName)) return 'FIXED';
    if (SPECIALIZED_RE.test(nodeName)) return 'SPECIALIZED';
    return '';
  }

  function getNestedValue(value, ...keys) {
    let current = value;
    for (const key of keys) {
      if (!current || typeof current !== 'object') return '';
      current = current[key];
    }
    return clean(current);
  }

  function getStableIdentity(proxy, nodeName) {
    const explicitId = nodeName.match(STABLE_ID_RE)?.[1];
    if (explicitId) return `explicit:${explicitId.toUpperCase()}`;

    const endpointIdentity = [
      clean(proxy.type).toLowerCase(),
      clean(proxy.server).toLowerCase(),
      clean(proxy.port),
      clean(proxy.network).toLowerCase(),
      clean(proxy.sni || proxy.servername || proxy['server-name']).toLowerCase(),
      getNestedValue(proxy, 'reality-opts', 'public-key'),
      getNestedValue(proxy, 'reality-opts', 'short-id'),
      clean(proxy.plugin).toLowerCase(),
      getNestedValue(proxy, 'plugin-opts', 'host').toLowerCase(),
      clean(proxy.obfs).toLowerCase(),
      clean(proxy['obfs-password']),
    ].join('\u0000');

    // Non-standard proxy types may not expose server/port in the usual fields.
    // Their original name is the safest available deterministic fallback.
    if (!clean(proxy.server) && !clean(proxy.port)) {
      return `${endpointIdentity}\u0000name:${clean(nodeName)}`;
    }
    return endpointIdentity;
  }

  function stableNumericId(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return String(hash >>> 0).padStart(CONFIG.stableIdWidth, '0');
  }

  const prepared = proxies.map(proxy => {
    const { address, nodeName } = splitAddress(proxy);

    if (isInfoNode(nodeName)) {
      return { proxy, info: true };
    }

    return {
      proxy,
      info: false,
      address: cleanSegment(address, CONFIG.unknownAddress),
      region: cleanSegment(
        getRegion(proxy, nodeName),
        CONFIG.unknownRegion,
      ),
      protocol: cleanSegment(
        getProtocol(proxy, nodeName),
        CONFIG.unknownProtocol,
      ),
      lineTag: getLineTag(nodeName),
      ipv6: IPV6_RE.test(nodeName),
      identity: getStableIdentity(proxy, nodeName),
    };
  });

  const kept = CONFIG.dropInfoNodes
    ? prepared.filter(item => !item.info)
    : prepared;

  const generatedNames = new Map();

  return kept.map(item => {
    // IF NOTICE NODES ARE RETAINED, THEY STILL RECEIVE VALID FIELDS.
    if (item.info) {
      const { address } = splitAddress(item.proxy);
      item.address = cleanSegment(address, CONFIG.unknownAddress);
      item.region = CONFIG.unknownRegion;
      item.protocol = cleanSegment(
        getProtocol(item.proxy, item.proxy.name),
        CONFIG.unknownProtocol,
      );
      item.lineTag = '';
      item.ipv6 = false;
      item.identity = getStableIdentity(item.proxy, item.proxy.name);
    }

    const identityKey = [
      item.address,
      item.region,
      item.protocol,
      item.lineTag,
      item.ipv6 ? 'IPV6' : '',
      item.identity,
    ].join('\u0000');
    const stableId = stableNumericId(identityKey);
    const normalizedName = [
      item.address,
      item.region,
      item.protocol,
      ...(item.lineTag
        ? [{ FIXED: 'F', SPECIALIZED: 'SP' }[item.lineTag]]
        : []),
      ...(item.ipv6 ? ['V6'] : []),
      stableId,
    ].join('-');

    if (generatedNames.has(normalizedName)) {
      throw new Error(
        `节点稳定标识冲突: ${normalizedName}；请删除重复节点或给节点添加唯一的 [ID:...] 标记`,
      );
    }
    generatedNames.set(normalizedName, item.identity);
    item.proxy.name = normalizedName;

    return item.proxy;
  });
}
