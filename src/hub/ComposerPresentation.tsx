import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { t } from './i18n';

export function ComposerPresentation({ text, compact = false, className = '', children }: {
  text: string; compact?: boolean; className?: string; children: ReactNode;
}) {
  const host = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const area = host.current!, workspace = area.closest('.workspace')!;
    const input = area.querySelector('textarea')!;
    const references = area.querySelector<HTMLElement>('.composer-reference-content')!;
    const fit = () => {
      const style = getComputedStyle(input), output = workspace.querySelector<HTMLElement>('.output')!;
      const outputStyle = getComputedStyle(output);
      const line = parseFloat(style.lineHeight);
      const base = line * input.rows + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const row = workspace.querySelector<HTMLElement>('.xterm-rows > div');
      const logLine = row?.getBoundingClientRect().height || line;
      const siblings = Array.from(workspace.children).filter(n => n !== area && n !== output);
      const occupied = siblings.reduce((height, n) => height + n.getBoundingClientRect().height, 0);
      const terminal = output.querySelector<HTMLElement>('.terminal-host');
      const chrome = terminal ? output.clientHeight - terminal.clientHeight
        : parseFloat(outputStyle.paddingTop) + parseFloat(outputStyle.paddingBottom);
      const reserve = logLine * 3 + chrome;
      const padding = parseFloat(getComputedStyle(area).paddingBottom);
      const budget = Math.max(base, workspace.clientHeight - occupied - reserve - padding - 2);
      // 첨부 영역 비율이다. 늘리면 첨부 공간이 커지고, 줄이면 본문 공간이 커진다.
      references.style.maxHeight = `${Math.max(0, (budget - base) / 2)}px`;
      input.style.height = '0px';
      input.style.height = `${compact ? base : Math.min(Math.max(base, input.scrollHeight), budget - references.offsetHeight)}px`;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(workspace);
    for (const element of workspace.querySelectorAll('.workspace-context, .hub-activity, .output, .composer-reference-content')) resize.observe(element);
    const changes = new MutationObserver(fit);
    changes.observe(references, { childList: true, subtree: true, characterData: true });
    references.addEventListener('load', fit, true);
    window.addEventListener('resize', fit);
    return () => {
      resize.disconnect(); changes.disconnect(); references.removeEventListener('load', fit, true);
      window.removeEventListener('resize', fit);
    };
  }, [text, compact]);
  return <section ref={host} className={`composer-area ${className}`.trim()} aria-label={t('composer.label')}>{children}</section>;
}
