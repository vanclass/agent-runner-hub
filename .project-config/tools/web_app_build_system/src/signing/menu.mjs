import readline from 'node:readline/promises';
import { certificates, localSettings, signingSelection, selectCertificate, requireCertificate } from './certificates.mjs';

async function endpointInput(lines, signal) {
  const prompt = 'RFC 3161 endpoint (HTTP/S; B / Esc / empty: Back): ';
  if (lines) { console.log(prompt); return lines.next(); }
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return await input.question(prompt, { signal }); }
  finally { input.close(); }
}

export async function certificateMenu(root, local, lines, signal, choose) {
  let selected = 'refresh';
  while (true) {
    signal.throwIfAborted();
    console.log('[Build System] Checking Windows certificates in CurrentUser\\My...');
    let list = [], inventoryError, current;
    try { list = await certificates(root, signal); }
    catch (error) { signal.throwIfAborted(); inventoryError = error.message; }
    const stored = (await localSettings(local)).windowsSigning;
    let status = 'Unsigned — no certificate selected';
    try { current = signingSelection(stored); }
    catch (error) { status = 'Invalid selection: ' + error.message; }
    if (current) {
      try { status = 'Selected: ' + requireCertificate(list, current).subject; }
      catch (error) { status = 'Invalid selection: ' + error.message; }
    }
    const actions = [{ id: 'refresh', label: 'Refresh status and certificate list' },
      { id: 'remove', label: 'Remove selection — future Windows/Tauri builds will be unsigned' },
      ...list.map(item => ({ id: item.thumbprint, label: item.subject, certificate: item }))]
      .map((item, index) => ({ ...item, hostReadiness: 'ready', implementationStatus: 'implemented', selectionShortcut: String(index + 1) }));
    const presentation = {
      footer: 'Up/Down: Select | Enter/Number: Choose | B/Q/Esc: Back',
      lines: (entries, focus) => ['Windows code-signing certificates', '', 'Project status: ' + status,
        ...(current ? ['Thumbprint: ' + current.thumbprint, 'Timestamp endpoint: ' + current.timestampUrl] : []),
        'Store: CurrentUser\\My | Key access is proven during signing', '',
        ...(inventoryError ? ['Certificate discovery unavailable: ' + inventoryError] : []),
        ...entries.flatMap(item => ['  ' + (item.id === focus ? '> ' : '  ') + item.selectionShortcut + '. ' + item.label,
          ...(item.certificate ? ['      Thumbprint: ' + item.id,
            '      Expires: ' + item.certificate.notAfter + ' | ' + (item.certificate.usable ? 'Usable (key access untested)' : 'Unavailable: expired/not yet valid/private key missing')] : [])]),
        ...(!list.length ? ['  No code-signing certificates found.'] : []),
        'Number / Enter: Choose certificate or action', 'Up / Down: Select', 'B / Q / Esc: Back'],
    };
    const answer = await choose(actions, selected, lines, signal, presentation);
    selected = answer.selected;
    if (['q','b','back','exit','0','escape','cancel','\x1b','\x03'].includes(answer.choice)) return;
    const action = actions.find(item => answer.choice === '' ? item.id === selected
      : item.selectionShortcut === answer.choice || item.id.toLowerCase() === answer.choice);
    if (!action) continue;
    selected = action.id;
    try {
      if (action.id === 'refresh') continue;
      if (action.id === 'remove') {
        console.log('[Build System] Removing certificate selection; waiting for this checkout’s build to finish if needed. Ctrl+C cancels.');
        await selectCertificate(root, local, signal, null);
        console.log('Certificate selection removed. Future Windows/Tauri products: unsigned.');
      } else {
        requireCertificate(list, { thumbprint: action.id });
        const endpoint = (await endpointInput(lines, signal))?.trim();
        if (!endpoint || ['b','back','q','exit','escape','\x1b'].includes(endpoint.toLowerCase())) continue;
        console.log('[Build System] Saving certificate selection; waiting for this checkout’s build to finish if needed. Ctrl+C cancels.');
        await selectCertificate(root, local, signal, { thumbprint: action.id, timestampUrl: endpoint });
        console.log('Certificate selected: ' + action.label + '\n  Thumbprint: ' + action.id);
      }
    } catch (error) { signal.throwIfAborted(); console.error('Certificate action failed: ' + error.message); }
  }
}

export async function certificateCli(root, local, args, signal) {
  const { certificateStatus } = await import('./certificates.mjs');
  const action = args[1];
  if (action === 'list' && args.length === 2) return certificates(root, signal);
  if (action === 'status' && args.length === 2) return certificateStatus(root, local, signal);
  if (action === 'remove' && args.length === 2) {
    await selectCertificate(root, local, signal, null);
    return { status: 'unsigned', selected: null };
  }
  if (action === 'select' && args.length === 4) {
    await selectCertificate(root, local, signal, { thumbprint: args[2], timestampUrl: args[3] });
    return certificateStatus(root, local, signal);
  }
  throw new Error('Use --certificate list | status | remove | select <thumbprint> <RFC3161-url>.');
}
