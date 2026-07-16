/**
 * Sub-Store subscription operator: add source identity and shared defaults.
 */
async function operator(proxies = [], targetPlatform, context) {
  return proxies.map(proxy => {
    const subName =
      proxy._subDisplayName ||
      proxy._subName ||
      'Unknown';

    const prefix = `${subName}-`;

    // 防止重复添加订阅名前缀
    if (!proxy.name.startsWith(prefix)) {
      proxy.name = prefix + proxy.name;
    }

    proxy.ecn = true;
    proxy['test-url'] = 'http://1.0.0.1/generate_204';

    return proxy;
  });
}
