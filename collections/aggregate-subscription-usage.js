/**
 * Sub-Store collection operator: aggregate subscription usage (strict mode).
 *
 * 默认行为：
 *   - 仅聚合当前可用、未过期的订阅。
 *   - 任一应提供流量信息的订阅失败时，不发布不完整合计。
 *   - 已用量超过总量的套餐按“已用尽”处理，不允许负余额抵扣其他套餐。
 *   - Sub-Store >= 2.20.69 仅写实时响应头；旧后端才写回组合订阅。
 *   - 不修改节点，避免影响后续重命名和 Stash 策略组脚本。
 *
 * 可选参数：
 *   - allow_partial=true：允许在部分订阅失败时发布成功部分的合计。
 *   - include_expired=true：把已过期订阅也纳入合计，并保留最早到期时间。
 */
async function operator(proxies = [], targetPlatform, context = {}) {
  const SUBS_KEY = 'subs';
  const COLLECTIONS_KEY = 'collections';
  const $ = $substore;
  const runtimeArgs =
    typeof $arguments === 'undefined' ? {} : ($arguments || {});
  const hasRealtimeResponse =
    typeof $options !== 'undefined' && Boolean($options);
  const { source = {} } = context;
  const collection = source._collection;

  if (!collection || Object.keys(source).some(key => key !== '_collection')) {
    throw new Error('暂时仅支持组合订阅，请把此脚本添加到组合订阅中');
  }

  const { getFlowHeaders, normalizeFlowHeader } = flowUtils;
  const allowPartial = isTrue(runtimeArgs.allow_partial);
  const includeExpired = isTrue(runtimeArgs.include_expired);
  const storedSubs = $.read(SUBS_KEY);
  const allSubs = Array.isArray(storedSubs) ? storedSubs : [];
  const selectedNames = new Set(
    Array.isArray(collection.subscriptions) ? collection.subscriptions : [],
  );
  const selectedTags = new Set(
    Array.isArray(collection.subscriptionTags)
      ? collection.subscriptionTags
      : [],
  );

  if (selectedTags.size > 0) {
    for (const sub of allSubs) {
      if (
        Array.isArray(sub.tag) &&
        sub.tag.some(tag => selectedTags.has(tag))
      ) {
        selectedNames.add(sub.name);
      }
    }
  }

  const selectedSubs = allSubs.filter(sub => selectedNames.has(sub.name));

  function isTrue(value) {
    if (value === true || value === 1) return true;
    return /^(?:1|true|yes|on)$/i.test(String(value || '').trim());
  }

  function firstNonEmptyLine(value) {
    return (
      String(value || '')
        .split(/[\r\n]+/)
        .map(line => line.trim())
        .find(Boolean) || ''
    );
  }

  function safeDecode(value, plusAsSpace = false) {
    const text = String(value);
    try {
      return decodeURIComponent(plusAsSpace ? text.replace(/\+/g, ' ') : text);
    } catch (_) {
      return text;
    }
  }

  function parseUrlConfig(rawValue) {
    const rawUrl = firstNonEmptyLine(rawValue);
    const hashIndex = rawUrl.indexOf('#');

    if (hashIndex < 0) {
      return { rawUrl, url: rawUrl, args: {} };
    }

    const url = rawUrl.slice(0, hashIndex);
    const fragment = rawUrl.slice(hashIndex + 1);
    let args;

    try {
      const parsed = JSON.parse(safeDecode(fragment));
      args = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_) {
      args = {};

      for (const pair of fragment.split('&')) {
        if (!pair) continue;
        const eqIndex = pair.indexOf('=');
        const rawKey = eqIndex < 0 ? pair : pair.slice(0, eqIndex);
        const rawValue = eqIndex < 0 ? '' : pair.slice(eqIndex + 1);
        const key = safeDecode(rawKey, true);

        if (key) {
          args[key] = rawValue === '' ? true : safeDecode(rawValue, true);
        }
      }
    }

    return { rawUrl, url, args };
  }

  function isRemoteSub(sub) {
    return (
      sub.source !== 'local' ||
      ['localFirst', 'remoteFirst'].includes(sub.mergeSources)
    );
  }

  function hasFlowSource(sub) {
    if (sub.subUserinfo) return true;
    if (!isRemoteSub(sub)) return false;

    const { url, args } = parseUrlConfig(sub.url);
    if (isTrue(args.noFlow)) return false;
    return (
      /^https?:\/\//i.test(url) ||
      /^https?:\/\//i.test(String(args.flowUrl || '').trim())
    );
  }

  function parseStrictFlowInfo(rawFlowInfo) {
    const requiredKeys = new Set(['upload', 'download', 'total']);
    const firstValues = new Map();

    for (const part of String(rawFlowInfo).split(';')) {
      const eqIndex = part.indexOf('=');
      if (eqIndex < 0) continue;

      const key = part.slice(0, eqIndex).trim().toLowerCase();
      if (
        !requiredKeys.has(key) &&
        key !== 'expire'
      ) {
        continue;
      }
      if (!firstValues.has(key)) {
        firstValues.set(key, safeDecode(part.slice(eqIndex + 1).trim()));
      }
    }

    for (const key of requiredKeys) {
      if (!firstValues.has(key)) {
        throw new Error(`缺少 ${key} 字段`);
      }
    }

    const parseCounter = key => {
      const raw = String(firstValues.get(key)).trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) {
        throw new Error(`${key} 不是有效数字`);
      }

      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${key} 必须是非负安全整数`);
      }
      return value;
    };

    const upload = parseCounter('upload');
    const download = parseCounter('download');
    const total = parseCounter('total');
    const used = safeAdd(upload, download, '单订阅已用流量');

    if (total === 0 && used > 0) {
      throw new Error('total=0 但已用流量大于 0，无法可靠聚合');
    }

    let expires;
    if (firstValues.has('expire')) {
      const rawExpire = String(firstValues.get('expire')).trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(rawExpire)) {
        throw new Error('expire 不是有效时间戳');
      }

      expires = Number(rawExpire);
      if (!Number.isFinite(expires) || expires <= 0) {
        expires = undefined;
      } else {
        // 兼容少数机场返回的毫秒时间戳。
        if (expires >= 100000000000) expires /= 1000;
        expires = Math.floor(expires);
        if (!Number.isSafeInteger(expires)) {
          throw new Error('expire 超出安全整数范围');
        }
      }
    }

    const exhausted = total > 0 && used > total;
    const effectiveUpload = exhausted ? Math.min(upload, total) : upload;
    const effectiveDownload = exhausted
      ? total - effectiveUpload
      : download;

    return {
      upload: effectiveUpload,
      download: effectiveDownload,
      total,
      expires,
      exhausted,
      rawUsed: used,
    };
  }

  function safeAdd(left, right, label) {
    const value = left + right;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} 超出安全整数范围`);
    }
    return value;
  }

  async function getSubFlowResult(sub) {
    let flowInfo;
    let customFlowInfo;

    if (isRemoteSub(sub)) {
      const { rawUrl, url, args } = parseUrlConfig(sub.url);

      if (
        !isTrue(args.noFlow) &&
        (/^https?:\/\//i.test(url) ||
          /^https?:\/\//i.test(String(args.flowUrl || '').trim()))
      ) {
        try {
          flowInfo = await getFlowHeaders(
            rawUrl,
            args.flowUserAgent,
            undefined,
            sub.proxy,
            args.flowUrl,
            args.flowHeaders || args.headers,
          );
        } catch (error) {
          $.error(
            `订阅 ${sub.name} 获取主流量信息失败，将继续尝试自定义流量信息: ${error?.message || error}`,
          );
        }
      }
    }

    if (sub.subUserinfo) {
      if (/^https?:\/\//i.test(String(sub.subUserinfo).trim())) {
        try {
          customFlowInfo = await getFlowHeaders(
            undefined,
            undefined,
            undefined,
            sub.proxy,
            sub.subUserinfo,
          );
        } catch (error) {
          $.error(
            `订阅 ${sub.name} 获取自定义流量链接失败: ${error?.message || error}`,
          );
        }
      } else {
        customFlowInfo = sub.subUserinfo;
      }
    }

    const merged = [customFlowInfo, flowInfo].filter(Boolean).join(';');
    if (!merged) {
      return { status: 'failed', name: sub.name, reason: '没有取得流量信息' };
    }

    try {
      // 先严格检查原始数字，防止 normalizeFlowHeader 把非法值静默变成 0。
      const parsed = parseStrictFlowInfo(merged);
      const normalized = normalizeFlowHeader(merged, true);
      if (!normalized?.['subscription-userinfo']) {
        throw new Error('无法标准化 subscription-userinfo');
      }

      const now = Date.now() / 1000;
      if (!includeExpired && parsed.expires && parsed.expires <= now) {
        return { status: 'expired', name: sub.name, expires: parsed.expires };
      }

      if (parsed.exhausted) {
        return {
          status: 'exhausted',
          name: sub.name,
          info: { name: sub.name, ...parsed },
        };
      }

      return {
        status: 'ok',
        info: { name: sub.name, ...parsed },
      };
    } catch (error) {
      return {
        status: 'failed',
        name: sub.name,
        reason: error?.message || String(error),
      };
    }
  }

  const flowSubs = selectedSubs.filter(hasFlowSource);
  if (flowSubs.length === 0) {
    $.error(`组合订阅 ${collection.name} 没有可用于聚合的流量来源，保留原信息`);
    return proxies;
  }

  const settled = await Promise.all(flowSubs.map(getSubFlowResult));
  const failed = settled.filter(result => result.status === 'failed');
  const expired = settled.filter(result => result.status === 'expired');
  const exhausted = settled.filter(result => result.status === 'exhausted');
  const activeInfos = settled
    .filter(result => result.status === 'ok')
    .map(result => result.info);

  for (const result of failed) {
    $.error(`订阅 ${result.name} 未参与流量聚合: ${result.reason}`);
  }
  for (const result of expired) {
    $.info(`订阅 ${result.name} 已过期，未计入当前可用流量`);
  }
  for (const result of exhausted) {
    $.info(
      `订阅 ${result.name} 已用 ${result.info.rawUsed} 超过总量 ${result.info.total}，按剩余 0 处理`,
    );
  }

  if (failed.length > 0 && !allowPartial) {
    $.error(
      `组合订阅 ${collection.name} 有 ${failed.length} 个流量来源失败；严格模式不发布不完整合计，保留原信息`,
    );
    return proxies;
  }
  if (activeInfos.length === 0 && exhausted.length === 0) {
    $.error(`组合订阅 ${collection.name} 没有有效的未过期流量信息，保留原信息`);
    return proxies;
  }

  // 有正常套餐时，已用尽套餐贡献的剩余流量为 0，直接排除，避免其
  // 原始负余额抵扣其他套餐；若全部套餐都已用尽，则使用封顶后的计数
  // 发布一个明确的“剩余 0”结果，而不是继续展示上一次旧合计。
  const infos = activeInfos.length > 0
    ? activeInfos
    : exhausted.map(result => result.info);

  let uploadSum = 0;
  let downloadSum = 0;
  let totalSum = 0;
  let expire;

  try {
    for (const info of infos) {
      uploadSum = safeAdd(uploadSum, info.upload, '上传流量合计');
      downloadSum = safeAdd(downloadSum, info.download, '下载流量合计');
      totalSum = safeAdd(totalSum, info.total, '总流量合计');
      if (Number.isSafeInteger(info.expires)) {
        expire = expire == null
          ? info.expires
          : Math.min(expire, info.expires);
      }
    }
  } catch (error) {
    $.error(`组合订阅 ${collection.name} 聚合失败，保留原信息: ${error?.message || error}`);
    return proxies;
  }

  const subUserinfo = [
    `upload=${uploadSum}`,
    `download=${downloadSum}`,
    `total=${totalSum}`,
    ...(expire == null ? [] : [`expire=${expire}`]),
  ].join('; ');

  if (hasRealtimeResponse) {
    $options._res = {
      ...($options._res || {}),
      headers: {
        ...($options._res?.headers || {}),
        'subscription-userinfo': subUserinfo,
      },
    };
  } else {
    // 仅旧版后端需要写回，避免新版并发生成时覆盖整个 collections。
    const storedCollections = $.read(COLLECTIONS_KEY);
    const allCollections = Array.isArray(storedCollections)
      ? storedCollections
      : [];
    const storedCollection = allCollections.find(
      item => item.name === collection.name,
    );

    if (storedCollection) {
      if (storedCollection.subUserinfo !== subUserinfo) {
        storedCollection.subUserinfo = subUserinfo;
        $.write(allCollections, COLLECTIONS_KEY);
      }
    } else {
      $.error(`未在本地组合订阅列表中找到 ${collection.name}，跳过旧版写回`);
    }
  }

  $.info(
    `组合订阅 ${collection.name}: 选中 ${selectedSubs.length} 个订阅，可聚合 ${flowSubs.length} 个，正常 ${activeInfos.length} 个，已用尽 ${exhausted.length} 个，过期 ${expired.length} 个，失败 ${failed.length} 个${allowPartial ? '（允许部分汇总）' : ''}`,
  );

  return proxies;
}
