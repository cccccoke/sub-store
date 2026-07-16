// Sub-Store response transformer — set Stash download and usage headers.
// Add this as a separate "修改响应 / Response Transformer" shortcut script.
// It changes only the HTTP response header; status and body stay untouched.

const COLLECTION_NAME = 'Sub-Store';
const OUTPUT_FILENAME = 'Stash-Sub-Store.yaml';

// Keep the File URL free to use any internal name while making the downloaded
// Stash configuration explicitly identify itself as a YAML file.
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

let rawSubUserinfo;

// Prefer information already attached during this File request.
if (typeof $options !== 'undefined' && $options) {
  rawSubUserinfo = getHeaderIgnoreCase(
    $options._res?.headers,
    'subscription-userinfo',
  );
}

// With the unchanged File Script, the nested collection generation writes the
// last complete aggregate to the collection. Use it as the fallback source.
if (!rawSubUserinfo) {
  const storedCollections = $substore.read('collections');
  const collections = Array.isArray(storedCollections)
    ? storedCollections
    : [];
  const collection = collections.find(
    item => item?.name === COLLECTION_NAME,
  );
  rawSubUserinfo = collection?.subUserinfo;
}

if (rawSubUserinfo) {
  const normalized = flowUtils.normalizeFlowHeader(
    String(rawSubUserinfo),
    true,
  );
  const subUserinfo = normalized?.['subscription-userinfo'];

  if (subUserinfo) {
    try {
      const parsed = flowUtils.parseFlowHeaders(subUserinfo);
      const upload = parsed?.usage?.upload;
      const download = parsed?.usage?.download;
      const total = parsed?.total;

      if ([upload, download, total].every(Number.isFinite)) {
        $res.header['subscription-userinfo'] = subUserinfo;
        $substore.info(
          `文件响应已添加 ${COLLECTION_NAME} 的 subscription-userinfo`,
        );
      } else {
        $substore.error(
          `${COLLECTION_NAME} 的流量字段不完整，保持原响应不变`,
        );
      }
    } catch (error) {
      $substore.error(
        `${COLLECTION_NAME} 的流量信息解析失败，保持原响应不变: ${error?.message || error}`,
      );
    }
  } else {
    $substore.error(
      `${COLLECTION_NAME} 没有可用的 subscription-userinfo，保持原响应不变`,
    );
  }
} else {
  $substore.error(
    `未找到组合订阅 ${COLLECTION_NAME} 的聚合流量信息，保持原响应不变`,
  );
}
