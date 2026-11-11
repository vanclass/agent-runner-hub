import fs from 'node:fs/promises';
import path from 'node:path';
import { command } from '../native/process.mjs';

const exists = file => fs.stat(file).then(stat => stat.isFile() && stat.size > 0, () => false);
const kotlinString = value => JSON.stringify(value).replaceAll('$', '\\$');

async function callback(generated, cli) {
  const matches = [];
  async function visit(folder) {
    for (const name of await fs.readdir(folder)) {
      const file = path.join(folder, name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Android callback inputs must use plain staged files.');
      if (stat.isDirectory()) await visit(file);
      else if (name === 'BuildTask.kt') matches.push(file);
    }
  }
  await visit(path.join(generated, 'buildSrc'));
  if (matches.length !== 1) throw new Error('Expected one generated Android BuildTask.kt callback; custom callbacks need an explicit staging integration.');
  const file = matches[0], text = await fs.readFile(file, 'utf8');
  const executable = /val executable = """[^]*?""";/g;
  const arguments_ = /val args = listOf\([^]*?\);/g;
  if ([...text.matchAll(executable)].length !== 1 || [...text.matchAll(arguments_)].length !== 1
      || !text.includes('runTauriCli') || !text.includes('assemble')
      || !text.includes('workingDir(File(projectDir, rootDirRel))')) {
    throw new Error('Android BuildTask callback shape is unsupported; preserve custom task code and integrate its CLI entry explicitly.');
  }
  const updated = text.replace(executable, () => 'val executable = ' + kotlinString(process.execPath) + ';')
    .replace(arguments_, () => 'val args = listOf(' + [cli, 'android', 'android-studio-script'].map(kotlinString).join(', ') + ');');
  await fs.writeFile(file, updated);
}

async function offlineGradle(generated, environment, env, signal) {
  const properties = await fs.readFile(path.join(generated, 'gradle/wrapper/gradle-wrapper.properties'), 'utf8');
  const version = properties.match(/distributionUrl=.*gradle-(\d+\.\d+(?:\.\d+)?)-(bin|all)\.zip/)?.[1];
  if (!version) throw new Error('Offline Android build requires a recognized versioned Gradle wrapper distribution.');
  const flavor = properties.match(/distributionUrl=.*gradle-\d+\.\d+(?:\.\d+)?-(bin|all)\.zip/)?.[1];
  const folder = path.join(env.GRADLE_USER_HOME, 'wrapper/dists', 'gradle-' + version + '-' + flavor);
  const distributions = [];
  for (const name of await fs.readdir(folder).catch(() => [])) {
    const candidate = path.join(folder, name, 'gradle-' + version);
    const launcher = path.join(candidate, 'bin/gradle' + (process.platform === 'win32' ? '.bat' : ''));
    const jars = await fs.readdir(path.join(candidate, 'lib')).catch(() => []);
    if (await exists(launcher) && jars.some(file => file.endsWith('-' + version + '.jar'))) distributions.push(launcher);
  }
  if (distributions.length !== 1) throw new Error('Environment Preparation Required: dependency installation is disabled and one complete matching Gradle distribution is not available in the selected user cache. Populate native caches through an Android build with installation permitted, then retry offline.');
  const launcher = distributions[0], init = path.join(generated, 'wg4-offline.gradle');
  await fs.writeFile(init, 'startParameter.setOffline(true)\n');
  const options = ['--offline', '--no-daemon', '--no-configuration-cache', '--init-script', init];
  // The staging wrapper delegates to the existing distribution, so wrapper provisioning cannot download.
  const helper = path.join(generated, 'wg4-gradle.mjs');
  const processModule = new URL('../native/process.mjs', import.meta.url).href;
  const script = [
    "import path from 'node:path';",
    'import { command } from ' + JSON.stringify(processModule) + ';',
    'const controller = new AbortController();',
    "for (const event of ['SIGINT','SIGTERM',...(process.platform==='win32'?['SIGBREAK']:[])]) process.on(event,()=>controller.abort(new Error('Cancelled Gradle')));",
    'const launcher = ' + JSON.stringify(launcher) + ';',
    'const args = ' + JSON.stringify(options) + '.concat(process.argv.slice(2));',
    'let file=launcher, arguments_=args, extra={};',
    "if(process.platform==='win32') {",
    " if([launcher,...args].some(value=>/[%!\\r\\n\"]/.test(value))) throw new Error('Unsupported Windows Gradle path/argument quoting.');",
    " file=path.join(process.env.SystemRoot||'C:/Windows','System32/cmd.exe');",
    " arguments_=['/d','/s','/c','\"'+[launcher,...args].map(value=>'\"'+value+'\"').join(' ')+'\"'];",
    ' extra.windowsVerbatimArguments=true;',
    '}',
    'const result=await command(file,arguments_,process.cwd(),controller.signal,{quiet:false,...extra});',
    'process.exitCode=result.code||0;',
  ].join('\n') + '\n';
  await fs.writeFile(helper, script);
  if (process.platform === 'win32') {
    if (/[%"\r\n]/.test(process.execPath + helper)) throw new Error('Offline staging path needs a compatible Windows batch path.');
    await fs.writeFile(path.join(generated, 'gradlew.bat'), '@"' + process.execPath + '" "' + helper + '" %*\r\n');
  } else {
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    await fs.writeFile(path.join(generated, 'gradlew'), '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(helper) + ' "$@"\n', { mode: 0o755 });
    await fs.chmod(path.join(generated, 'gradlew'), 0o755);
  }
  signal.throwIfAborted();
  // Exercise the selected distribution before any packaging; the helper enforces the same offline flags.
  const check = await command(process.execPath, [helper, '--version'], generated, signal, { env });
  if (check.code !== 0 || !check.stdout.includes('Gradle ' + version)) {
    throw new Error('Selected cached Gradle cannot run offline with this JDK: ' + check.output);
  }
}

export async function configureGradle(generated, environment, allowed, env, signal) {
  const { sdk, policy } = environment;
  for (const name of ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.properties',
    'gradle/wrapper/gradle-wrapper.jar', 'app/build.gradle.kts']) {
    if (!await exists(path.join(generated, name))) throw new Error('Android initialization is incomplete: ' + name);
  }
  const settings = await Promise.all(['settings.gradle', 'settings.gradle.kts'].map(name => exists(path.join(generated, name))));
  if (!settings.some(Boolean)) throw new Error('Android initialization is missing Gradle settings.');
  if (process.platform !== 'win32') await fs.chmod(path.join(generated, 'gradlew'), 0o755);
  await callback(generated, environment.cli);
  const file = path.join(generated, 'app/build.gradle.kts'), original = await fs.readFile(file, 'utf8');
  const roots = [...original.matchAll(/\brootDirRel\s*=\s*"([^"$]+)"/g)];
  if (roots.length !== 1 || path.resolve(generated, 'app', roots[0][1]) !== path.resolve(generated, '../..')) {
    throw new Error('Android rootDirRel must resolve to the staged Rust backend; custom escaped/dynamic callbacks require explicit integration.');
  }
  const plugin = path.join(generated, 'buildSrc/src/main/kotlin');
  async function pluginSource(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) { const result = await pluginSource(path.join(folder, entry.name)); if (result) return result; }
      else if (entry.name === 'RustPlugin.kt') return fs.readFile(path.join(folder, entry.name), 'utf8');
    }
  }
  const source = await pluginSource(plugin);
  if (!source?.includes('rootDirRel = config.rootDirRel') || !source.includes('projectDir = project.projectDir.path')) {
    throw new Error('Android RustPlugin callback base is unsupported; original native project is preserved.');
  }
  if (/storeFile|storePassword|keyAlias|keyPassword/.test(original)) {
    throw new Error('Custom Android signing definitions need an explicit integration; local/test builds do not consume credentials.');
  }
  for (const [name, expected] of [['compileSdk', String(policy.compileSdk)], ['ndkVersion', policy.ndkVersion], ['buildToolsVersion', policy.buildTools]]) {
    const value = original.match(new RegExp('^\\s*' + name + '\\s*=\\s*"?([0-9.]+)', 'm'))?.[1];
    if (value && value !== expected) throw new Error('Custom Android ' + name + ' requires matching toolchain integration; original configuration is preserved.');
  }
  const end = original.includes('\r\n') ? '\r\n' : '\n';
  const suffix = ['', '// Execution-owned unsigned release configuration.', 'android {',
    '    compileSdk = ' + policy.compileSdk, '    buildToolsVersion = "' + policy.buildTools + '"',
    '    ndkVersion = "' + policy.ndkVersion + '"', '    buildTypes.getByName("release") { signingConfig = null }',
    '}', ''].join(end);
  await fs.writeFile(file, original + suffix);
  const propertiesFile = path.join(generated, 'gradle.properties');
  const properties = await fs.readFile(propertiesFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  await fs.writeFile(propertiesFile, properties + end + 'org.gradle.daemon=false' + end
    + 'android.builder.sdkDownload=false' + end + 'org.gradle.java.installations.auto-download=false' + end);
  const sdkPath = sdk.home.replace(/\\/g, '/').replace(/:/g, '\\:');
  await fs.writeFile(path.join(generated, 'local.properties'), 'sdk.dir=' + sdkPath + end);
  if (!allowed) await offlineGradle(generated, environment, env, signal);
}
