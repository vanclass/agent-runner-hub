import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CONTRACT = 'astro6-static-integrations-v1';
const recipes = ['astro-react.json', 'astro-tailwind.json'];
const unsupported = () => new Error('Only the selected, verified React integration and Tailwind Vite plugin are supported. '
  + 'Use direct zero-argument imported factories in a static object config; preserve custom code and resolve it in Settings.');

export async function appliedIntegrations(root) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.runner/project.json'), 'utf8'));
  if (manifest.schema_version !== 1 || manifest.kind !== 'project_management'
      || !Array.isArray(manifest.applied?.components)) throw unsupported();
  const component = manifest.applied.components.find(c => c.component_id === 'WebApp');
  const children = (component?.children || []).filter(c => c.group_id === 'Frameworks' || c.group_id === 'Styling');
  for (const child of children) {
    if (!child.evidence?.some(e => JSON.stringify(e.path) === '["astro","contract"]' && e.value === CONTRACT)) {
      throw new Error('Astro integration verification is pending. Complete reviewed Project Settings Apply before launching.');
    }
  }
  return children.map(c => c.option_id);
}

export async function validateIntegrations(root, user, permitted, recipeRoot, appliedRecipes = false) {
  const files = appliedRecipes ? recipes.map(name => path.join(recipeRoot, name)) : recipeRoot
    ? ['frameworks/astro/recipe.json', 'styling/astro/recipe.json'].map(name => path.join(recipeRoot, name))
    : recipes.map(name => fileURLToPath(new URL(name, import.meta.url)));
  const contracts = await Promise.all(files.map(name => fs.readFile(name, 'utf8').then(JSON.parse)));
  if (permitted.some(id => !contracts.some(c => c.identity === id)) || new Set(permitted).size !== permitted.length) throw unsupported();
  const selected = contracts.filter(c => permitted.includes(c.identity));
  const configured = [
    ['integrations', user.integrations],
    ['vite.plugins', user.vite?.plugins],
  ];
  for (const [key, values] of configured) {
    const expected = selected.filter(c => c.integration.key === key);
    if ((values != null && !Array.isArray(values)) || (values?.length || 0) !== expected.length) throw unsupported();
  }
  if (!selected.length) return;
  const require = createRequire(path.join(root, 'package.json'));
  for (const contract of selected) {
    for (const [name, version] of Object.entries({...contract.dependencies, ...contract.devDependencies})) {
      const packageFile = path.join(root, 'node_modules', name, 'package.json');
      if (await fs.realpath(packageFile) !== packageFile) throw unsupported();
      const installed = JSON.parse(await fs.readFile(packageFile, 'utf8'));
      if (installed.version !== version) throw new Error(name + ' must resolve to the verified version ' + version + '. Restore dependencies and Review/Apply.');
    }
  }
  const ts = require('typescript');
  const source = ts.createSourceFile('astro.config.mjs', await fs.readFile(path.join(root, 'astro.config.mjs'), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = new Map();
  const constants = new Map();
  let exported;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const module = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (module === 'astro/config' && !clause?.name && clause?.namedBindings
          && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length === 1) {
        const item = clause.namedBindings.elements[0];
        if ((item.propertyName || item.name).text !== 'defineConfig') throw unsupported();
        imports.set(item.name.text, 'astro/config');
      } else if (clause?.name && !clause.namedBindings && selected.some(c => c.integration.module === module)) {
        if (imports.has(clause.name.text)) throw unsupported();
        imports.set(clause.name.text, module);
      } else throw unsupported();
    } else if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || constants.has(declaration.name.text)) throw unsupported();
        constants.set(declaration.name.text, declaration.initializer);
      }
    } else if (ts.isExportAssignment(statement) && !exported) {
      exported = statement.expression;
    } else throw unsupported();
  }
  const used = new Set();
  const referencedConstants = new Set();
  function object(expression, seen = new Set()) {
    if (ts.isIdentifier(expression) && constants.has(expression.text) && !seen.has(expression.text)) {
      seen.add(expression.text);
      referencedConstants.add(expression.text);
      return object(constants.get(expression.text), seen);
    }
    if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
        && imports.get(expression.expression.text) === 'astro/config' && expression.arguments.length === 1) {
      return object(expression.arguments[0], seen);
    }
    if (!ts.isObjectLiteralExpression(expression)) throw unsupported();
    return expression;
  }
  function visit(expression, keys) {
    if (ts.isObjectLiteralExpression(expression)) {
      const names = new Set();
      for (const property of expression.properties) {
        if (!ts.isPropertyAssignment(property) || !property.name
            || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw unsupported();
        const name = property.name.text;
        if (names.has(name)) throw unsupported();
        names.add(name);
        visit(property.initializer, [...keys, name]);
      }
    } else if (ts.isArrayLiteralExpression(expression)) {
      for (const item of expression.elements) visit(item, keys);
    } else if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.arguments.length === 0) {
      const contract = selected.find(c => c.integration.key === keys.join('.')
        && c.integration.module === imports.get(expression.expression.text));
      if (!contract || used.has(contract.identity)) throw unsupported();
      used.add(contract.identity);
    } else if (!(ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)
        || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind))) {
      throw unsupported();
    }
  }
  if (!exported) throw unsupported();
  visit(object(exported), []);
  if (used.size !== selected.length || referencedConstants.size !== constants.size) throw unsupported();
}
