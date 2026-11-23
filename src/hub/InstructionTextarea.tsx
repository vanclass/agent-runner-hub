import { useLayoutEffect, type ComponentPropsWithoutRef } from 'react';
import type { InstructionHistory } from './instructionHistory';
import { instructionKey } from './instructionKey';

type Props = Omit<ComponentPropsWithoutRef<'textarea'>, 'value' | 'onChange'> & {
  value: string;
  history: InstructionHistory;
  edit: (value: string) => void;
  submit: (briefRun: boolean) => void;
};

export function InstructionTextarea({ history, value, edit, submit, ...props }: Props) {
  useLayoutEffect(() => () => history.finishComposition(), [history]);
  return <textarea {...props} data-instruction="true" value={value}
    onChange={event => {
      const next = event.currentTarget.value;
      history.record(value, next);
      edit(next);
    }}
    onCompositionStart={() => history.beginComposition(value)}
    onCompositionEnd={event => {
      if (!history.composing) return;
      const next = event.currentTarget.value;
      history.finishComposition(next);
      if (next !== value) edit(next);
    }}
    onBlur={() => history.finishComposition()}
    onKeyDown={event => {
      if (props.readOnly || history.composing) return;
      instructionKey(event, submit, action => {
        const next = history.move(action, value);
        if (next !== undefined) edit(next);
      });
    }} />;
}
