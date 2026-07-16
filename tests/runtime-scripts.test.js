const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadOperator(relativePath, globals = {}) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const context = vm.createContext({ ...globals });
  vm.runInContext(`${source}\nthis.__operator = operator;`, context, {
    filename: relativePath,
  });
  return context.__operator;
}

async function testStableNormalization() {
  const operator = loadOperator('collections/normalize-proxy-names.js', {
    ProxyUtils: {
      getISO(name) {
        return String(name).trim().slice(0, 2).toUpperCase();
      },
    },
  });

  const proxies = [
    {
      name: 'US Fixed [ID:AI-US-PRIMARY]',
      type: 'ss',
      server: 'fixed.example.com',
      port: 443,
      _subDisplayName: 'DEMO',
    },
    {
      name: 'HK Reality A',
      type: 'vless',
      server: 'hk-a.example.com',
      port: 443,
      network: 'tcp',
      _subDisplayName: 'DEMO',
    },
    {
      name: 'HK Reality B',
      type: 'vless',
      server: 'hk-b.example.com',
      port: 443,
      network: 'tcp',
      _subDisplayName: 'DEMO',
    },
  ];

  const forward = await operator(clone(proxies), 'Stash', {});
  const reverse = await operator(clone(proxies).reverse(), 'Stash', {});
  const byServer = values =>
    Object.fromEntries(values.map(proxy => [proxy.server, proxy.name]));

  assert.deepStrictEqual(
    byServer(forward),
    byServer(reverse),
    'upstream order must not change normalized names',
  );
  for (const proxy of forward) {
    assert.match(proxy.name, /-\d{10}$/);
  }

  const movedFixed = clone(proxies[0]);
  movedFixed.server = 'replacement.example.com';
  const [original] = await operator([clone(proxies[0])], 'Stash', {});
  const [replacement] = await operator([movedFixed], 'Stash', {});
  assert.strictEqual(
    original.name,
    replacement.name,
    'explicit [ID:...] must survive an endpoint replacement',
  );

  await assert.rejects(
    () => operator([clone(proxies[0]), clone(proxies[0])], 'Stash', {}),
    /稳定标识冲突/,
  );
}

async function runGenerator(policy) {
  const source = fs.readFileSync(
    path.join(ROOT, 'files/generate-stash-config.js'),
    'utf8',
  );
  const execute = new Function(
    'ProxyUtils',
    '$content',
    `return (async () => {\n${source}\nreturn $content;\n})();`,
  );
  const output = await execute(
    {
      yaml: {
        safeLoad: JSON.parse,
        safeDump: JSON.stringify,
      },
    },
    JSON.stringify(policy),
  );
  return JSON.parse(output);
}

function basePolicy(proxies) {
  return {
    mode: 'rule',
    proxies,
    'proxy-groups': [],
    'rule-providers': {
      ai: { behavior: 'domain', path: './rules/ai.yaml' },
      developer: { behavior: 'domain', path: './rules/developer.yaml' },
      'developer-download': {
        behavior: 'domain',
        path: './rules/developer-download.yaml',
      },
    },
    rules: [
      'RULE-SET,ai,AI Stable',
      'RULE-SET,developer-download,Developer Download',
      'RULE-SET,developer,Developer',
      'MATCH,Default Proxy',
    ],
  };
}

async function testGeneratedGroups() {
  const proxies = [
    {
      name: 'DEMO-US-SS-F-0000000001',
      type: 'ss',
      server: 'fixed.example.com',
      port: 443,
    },
    {
      name: 'DEMO-HK-VLESS-0000000002',
      type: 'vless',
      server: 'hk.example.com',
      port: 443,
      network: 'tcp',
      'reality-opts': { 'public-key': 'placeholder' },
      'benchmark-url': 'http://old.example.com',
      'test-url': 'http://old.example.com',
    },
    {
      name: 'DEMO-JP-SS-SP-0000000003',
      type: 'ss',
      server: 'jp.example.com',
      port: 443,
    },
    {
      name: 'DEMO-SG-HY2-0000000004',
      type: 'hysteria2',
      server: 'sg.example.com',
      port: 443,
    },
    {
      name: 'DEMO-US-TUIC-0000000005',
      type: 'tuic',
      server: 'us-quic.example.com',
      port: 443,
    },
    {
      name: 'DEMO-US-SS-0000000006',
      type: 'ss',
      server: 'us-plain.example.com',
      port: 443,
    },
    {
      name: 'DEMO-TW-SS-V6-0000000007',
      type: 'ss',
      server: 'tw-v6.example.com',
      port: 443,
    },
    {
      name: 'DEMO-TW-SS-F-0000000008',
      type: 'ss',
      server: 'tw-fixed.example.com',
      port: 443,
    },
    {
      name: 'DEMO-JP-SS-F-V6-0000000009',
      type: 'ss',
      server: 'jp-fixed-v6.example.com',
      port: 443,
    },
    {
      name: 'DEMO-HK-SS-F-0000000010',
      type: 'ss',
      server: 'hk-fixed.example.com',
      port: 443,
    },
  ];

  const output = await runGenerator(basePolicy(proxies));
  const groups = Object.fromEntries(
    output['proxy-groups'].map(group => [group.name, group]),
  );

  for (const name of [
    'Global Stable',
    'Default Proxy',
    'Developer',
    'Developer Download',
    'AI Stable',
    'AI US',
    'AI TW',
    'AI JP',
    'AI HK',
    'AI Emergency',
    'TCP Fast',
    'TCP Reliable',
    'QUIC Fast',
    'Regional Exit',
    'US',
    'US QUIC Fast',
    'Fixed Exit',
    'US Fixed Exit',
    'IPv6',
    'Manual',
  ]) {
    assert(groups[name], `missing group ${name}`);
  }

  assert.strictEqual(groups['Default Proxy'].proxies[0], 'TCP Fast');
  assert.strictEqual(groups.Developer.proxies[0], 'TCP Reliable');
  assert.strictEqual(groups['Developer Download'].proxies[0], 'TCP Fast');
  assert.strictEqual(groups['AI Stable'].type, 'select');
  assert.strictEqual(groups['AI Stable'].proxies[0], 'AI US');
  assert.strictEqual(groups['AI Stable'].proxies[1], 'AI TW');
  assert.strictEqual(groups['AI Stable'].proxies[2], 'AI JP');
  assert.strictEqual(groups['AI Stable'].proxies[3], 'AI HK');
  assert.strictEqual(groups['AI Stable'].proxies.at(-1), 'AI Emergency');
  assert.deepStrictEqual(
    groups['AI US'].proxies,
    ['DEMO-US-SS-F-0000000001'],
  );
  assert.deepStrictEqual(
    groups['AI TW'].proxies,
    ['DEMO-TW-SS-F-0000000008'],
  );
  assert.deepStrictEqual(
    groups['AI JP'].proxies,
    ['DEMO-JP-SS-F-V6-0000000009'],
  );
  assert.deepStrictEqual(
    groups['AI HK'].proxies,
    ['DEMO-HK-SS-F-0000000010'],
  );
  assert.strictEqual(groups['US Fixed Exit'].type, 'select');
  assert(!groups['TCP Fast'].proxies.includes('DEMO-US-SS-F-0000000001'));
  assert(!groups.US.proxies.includes('DEMO-US-SS-F-0000000001'));
  assert(groups.US.proxies.includes('DEMO-US-SS-0000000006'));
  assert(!Object.hasOwn(output.proxies[0], 'benchmark-url'));
  assert(!Object.hasOwn(output.proxies[0], 'test-url'));

  const withoutUS = await runGenerator(basePolicy(proxies.slice(1)));
  const withoutUSGroups = Object.fromEntries(
    withoutUS['proxy-groups'].map(group => [group.name, group]),
  );
  assert.strictEqual(
    withoutUSGroups['AI Stable'].proxies[0],
    'AI TW',
  );

  const withoutPreferredRegions = proxies.filter(
    proxy => !/^DEMO-(?:US|TW|JP)-[^-]+-F(?:-V6)?-\d+$/.test(proxy.name),
  );
  const otherRegionOutput = await runGenerator(
    basePolicy(withoutPreferredRegions),
  );
  const otherRegionGroups = Object.fromEntries(
    otherRegionOutput['proxy-groups'].map(group => [group.name, group]),
  );
  assert.strictEqual(
    otherRegionGroups['AI Stable'].proxies[0],
    'AI HK',
  );

  const withoutFixed = proxies.filter(
    proxy => !/-F(?:-V6)?-\d+$/.test(proxy.name),
  );
  await assert.rejects(
    () => runGenerator(basePolicy(withoutFixed)),
    /AI Stable 没有/,
  );

  const badProviderPolicy = basePolicy(proxies);
  badProviderPolicy.rules.unshift('RULE-SET,missing,Developer');
  await assert.rejects(
    () => runGenerator(badProviderPolicy),
    /不存在的规则集合 missing/,
  );
}

function testResponseTransformer() {
  const source = fs.readFileSync(
    path.join(ROOT, 'files/set-stash-response-headers.js'),
    'utf8',
  );
  const logs = [];
  const context = vm.createContext({
    $res: {
      status: 200,
      body: 'original-yaml',
      header: {
        'Subscription-Userinfo': 'upload=1; download=2; total=3',
      },
    },
    $options: {},
    $substore: {
      info(message) {
        logs.push(['info', message]);
      },
      error(message) {
        logs.push(['error', message]);
      },
    },
    flowUtils: {
      normalizeFlowHeader(value) {
        return { 'subscription-userinfo': value };
      },
      parseFlowHeaders() {
        return { usage: { upload: 1, download: 2 }, total: 3 };
      },
    },
  });

  vm.runInContext(source, context, {
    filename: 'files/set-stash-response-headers.js',
  });
  assert.strictEqual(context.$res.status, 200);
  assert.strictEqual(context.$res.body, 'original-yaml');
  assert.strictEqual(
    context.$res.header['content-type'],
    'text/yaml; charset=utf-8',
  );
  assert.strictEqual(
    context.$res.header['subscription-userinfo'],
    'upload=1; download=2; total=3',
  );
  assert(!Object.hasOwn(context.$res.header, 'Subscription-Userinfo'));
  assert(logs.some(([level]) => level === 'info'));
}

(async () => {
  await testStableNormalization();
  await testGeneratedGroups();
  testResponseTransformer();
  process.stdout.write('runtime script tests passed\n');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
