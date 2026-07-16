/**
 * Sub-Store subscription operator: preserve the subscription identity in names.
 *
 * Protocol options and benchmark settings intentionally remain untouched. They
 * belong to the provider or the final Stash configuration, not this generic
 * preprocessing stage.
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

    return proxy;
  });
}
