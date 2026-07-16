/**
 * Sub-Store collection operator: normalize names for the Stash generator.
 *
 * OUTPUT:
 * ADDRESS-REGION-PROTOCOL-[F|SP]-[V6]-SERIAL
 *
 * EXAMPLES:
 * KTM-HK-VLESS-F-01
 * KTM-HK-SS-SP-01
 * KTM-HK-HY2-01
 * KTM-TW-SS-V6-01
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
    serialWidth: 2,
  };

  const INFO_RE =
    /(?:剩余|已用|可用|总计?)流量|套餐到期|到期时间|过期时间|有效期|过滤掉\s*\d*\s*条|已过滤\s*\d*\s*条|traffic\s*(?:left|remain)|bandwidth|quota|expir(?:e|y)/i;

  // FIXED IS DETERMINED ONLY FROM THE ORIGINAL NODE NAME.
  const FIXED_RE =
    /固定(?:IP)?|静态(?:IP)?|独享(?:IP)?|独立IP|dedicated|static\s*ip|fixed\s*ip|(?:^|[-_\s])(?:fixed|f)(?=$|[-_\s])/i;

  // SPECIALIZED LINE IDENTIFIERS. EDIT THIS REGEX IF MORE TAGS ARE NEEDED.
  const SPECIALIZED_RE =
    /专线|專線|(?:^|[^A-Z0-9])(?:IEPL|IPLC|MPLS|DIA|BGP|CN2\s*GIA|CN2|CUG|CTG|CMI|AS9929|9929|PRIVATE\s*LINE|LEASED\s*LINE|SPECIALIZED|SP)(?=$|[^A-Z0-9])/i;

  // IPV6 IS ALSO DETERMINED ONLY FROM THE ORIGINAL NODE NAME.
  const IPV6_RE =
    /(?:^|[^A-Z0-9])(?:IPV6|V6)(?=$|[^A-Z0-9])/i;

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

    // SUPPORT HK2-HY2, US1-HY2 AND US-1TCP.
    const isoAtStart = nodeName
      .match(/^\s*([A-Za-z]{2})(?=[^A-Za-z]|$)/)?.[1]
      ?.toUpperCase();

    const nonRegionTokens = new Set([
      'SS', 'SR', 'VM', 'VL', 'HY', 'WG', 'IP', 'WS',
    ]);

    if (isoAtStart && !nonRegionTokens.has(isoAtStart)) {
      return isoAtStart;
    }

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
    };
  });

  const kept = CONFIG.dropInfoNodes
    ? prepared.filter(item => !item.info)
    : prepared;

  const counters = new Map();

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
    }

    const groupKey = [
      item.address,
      item.region,
      item.protocol,
      item.lineTag,
      item.ipv6 ? 'IPV6' : '',
    ].join('\u0000');

    const serial = (counters.get(groupKey) || 0) + 1;
    counters.set(groupKey, serial);

    const serialText = String(serial).padStart(
      CONFIG.serialWidth,
      '0',
    );

    item.proxy.name = [
      item.address,
      item.region,
      item.protocol,
      ...(item.lineTag
        ? [{ FIXED: 'F', SPECIALIZED: 'SP' }[item.lineTag]]
        : []),
      ...(item.ipv6 ? ['V6'] : []),
      serialText,
    ].join('-');

    return item.proxy;
  });
}
