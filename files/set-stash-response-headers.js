// Sub-Store response transformer — set Stash download and usage headers.
// Add this as a separate "修改响应 / Response Transformer" operation.
// The File's "查询流量信息订阅链接" is the only flow source; this script has
// no collection-name fallback and never changes the response body or status.

const OUTPUT_FILENAME = 'Stash-SubStore.yaml';

$res.header['content-type'] = 'text/yaml; charset=utf-8';
$res.header['content-disposition'] =
  `attachment; filename*=UTF-8''${encodeURIComponent(OUTPUT_FILENAME)}`;

function getHeaderIgnoreCase(headers, targetName) {
  if (!headers || typeof headers !== 'object') return undefined;
  const target = targetName.toLowerCase();
  const key = Object.keys(headers).find(
    name => name.toLowerCase() === target,
  );
  return key ? headers[key] : undefined;
}

let rawSubUserinfo = getHeaderIgnoreCase(
  $res.header,
  'subscription-userinfo',
);

if (!rawSubUserinfo && typeof $options !== 'undefined' && $options) {
  rawSubUserinfo = getHeaderIgnoreCase(
    $options._res?.headers,
    'subscription-userinfo',
  );
}

if (!rawSubUserinfo) {
  $substore.error(
    '文件响应没有 subscription-userinfo；请配置“查询流量信息订阅链接”',
  );
} else {
  const normalized = flowUtils.normalizeFlowHeader(
    String(rawSubUserinfo),
    true,
  );
  const subUserinfo = normalized?.['subscription-userinfo'];

  if (!subUserinfo) {
    $substore.error('流量信息无法标准化，保持原响应头不变');
  } else {
    try {
      const parsed = flowUtils.parseFlowHeaders(subUserinfo);
      const upload = parsed?.usage?.upload;
      const download = parsed?.usage?.download;
      const total = parsed?.total;

      if (![upload, download, total].every(Number.isFinite)) {
        throw new Error('upload/download/total 字段不完整');
      }

      for (const name of Object.keys($res.header)) {
        if (name.toLowerCase() === 'subscription-userinfo') {
          delete $res.header[name];
        }
      }
      $res.header['subscription-userinfo'] = subUserinfo;
      $substore.info('文件响应已保留有效的 subscription-userinfo');
    } catch (error) {
      $substore.error(
        `流量信息解析失败，保持原响应头不变: ${error?.message || error}`,
      );
    }
  }
}
