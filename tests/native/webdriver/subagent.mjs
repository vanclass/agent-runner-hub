import { defineNativeCase, BlockedPrerequisite } from '../../../tools/native-probe/case.mjs';

export function subagentRun() {
  const deferred = () => {
    throw new BlockedPrerequisite('R04 role selection depended on the retired RunnerInteractionPanel. Separate structured interaction support is deferred; historical acceptance is not current presentation acceptance.');
  };
  return defineNativeCase({ id: 'subagent-run', presentation: 'background', ready: deferred, run: deferred });
}
