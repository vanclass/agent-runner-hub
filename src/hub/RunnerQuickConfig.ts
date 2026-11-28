import { controlTiming, flattenCommands, type CommandAttempt, type RunnerControl } from './runnerControl';
import { errorText, HubError, msg, type HubText } from './i18n';
import { record, same, validDesired, type ConfigAccount, type ConfigCatalog, type ConfigDesired,
  type InteractionAction, type ProviderCatalog } from './runnerConfigContract';
import type { HubSelections } from './HubSelections';

type Choice = { choice_id: string; label: string; description: string; enabled: boolean; disabled_reason: string };
type Interaction = { interaction_id: string; state: 'active'; prompt: string; context: string;
  actions: InteractionAction['action'][]; choices: Choice[]; consequences?: { text: string; role: string; details: string[] }[] };
type Control = Pick<RunnerControl, 'snapshot' | 'config' | 'work' | 'assignmentLocked' | 'busy'
  | 'observationFresh' | 'commandUnresolved' | 'fresh' | 'command' | 'interaction'>;
const applyOutcomes = { partial: 'quick.partial', rejected: 'quick.rejected', cancelled: 'quick.cancelled',
  failed: 'quick.failed', unknown: 'quick.unknown' } as const;

export class RunnerQuickConfig {
  detail: HubText = '';
  confirmations: string[] = [];
  interaction?: Interaction;
  interactionBusy = false;
  private interactionUnknown = false;
  private continuation?: { command: string; attempt: CommandAttempt; provider: string | undefined };
  constructor(private readonly control: Control, private readonly selections: () => HubSelections | undefined,
    private readonly editable: () => boolean, private readonly changed: () => void) {}

  get available() {
    return !this.interactionBusy && this.editable() && this.control.observationFresh && !this.control.busy && !this.control.config.uncertain
      && !this.control.work.busy && !this.control.commandUnresolved
      && !this.control.snapshot.observation?.attention.foreground_interaction_active;
  }

  async load(provider: boolean): Promise<{ catalog?: ConfigCatalog; providers?: ProviderCatalog; error?: HubText }> {
    const { config } = this.control;
    if (!this.available && !(provider && config.providerOutcomeUnknown && !this.control.busy && this.editable()))
      return { error: msg('quick.unavailable') };
    try {
      if (provider && config.providerOutcomeUnknown) await this.control.fresh();
      const result = await (provider ? config.inspectProviders() : config.inspect());
      return result ?? { error: msg('quick.unavailable') };
    } catch (reason) { return { error: errorText(reason) }; }
  }

  async change(desired: ConfigDesired, reasoningAccount?: ConfigAccount) {
    if (!this.available) return;
    const { config } = this.control;
    const owner = this.selections();
    this.control.assignmentLocked = true;
    this.detail = ''; this.confirmations = []; this.changed();
    try {
      config.resetDraft();
      const inspection = await config.inspect(desired.account);
      const catalog = inspection?.catalog;
      if (!catalog) { this.detail = inspection?.error ?? msg('quick.unavailable'); return; }
      const { current, effective } = catalog.inspection;
      if (reasoningAccount && (!same(reasoningAccount, current.account) || current.model.id !== desired.model?.id
        || (effective.next_model ?? effective.model) !== desired.model?.id))
        throw new HubError(msg('config.stalePlan'));
      if (desired.account && !desired.model && !validDesired(desired, catalog.inspection.current, catalog))
        return { catalog, account: desired.account };
      config.setDraft(desired);
      await config.createPlan();
      if (reasoningAccount && config.plan && config.plan.revision !== catalog.inspection.revision)
        throw new HubError(msg('config.stalePlan'));
      this.confirmations = config.plan?.required_confirmations ?? [];
      if (!config.canApply) {
        if (config.plan?.errors.length) this.detail = msg('config.requestFailed', { code: config.plan.errors.join(', ') });
        else if (!this.confirmations.length) this.detail = config.error;
        return;
      }
      const previous = config.latestApplication;
      await config.apply(application => {
        if (owner !== this.selections() || !application.result) return;
        const committed: ConfigDesired = {};
        for (const step of application.result.results) {
          if (step.outcome !== 'success' || !step.committed) continue;
          const verified = step.setting === 'run_mode' ? ['run_mode', 'root'] as const : [step.setting];
          for (const key of verified) Object.assign(committed, { [key]: step.committed[key] });
        }
        if (application.result.apply_status === 'applied') Object.assign(committed, application.plan.desired);
        if (Object.keys(committed).length) owner?.synchronizeConfirmed(config, committed,
          { ...application.before, ...committed }, catalog);
      });
      const result = config.latestApplication !== previous ? config.latestApplication?.result : undefined;
      if (result) {
        this.confirmations = result.plan?.required_confirmations ?? [];
        if (result.apply_status !== 'applied') this.detail = msg('quick.outcome', {
          status: msg(applyOutcomes[result.apply_status]), code: result.code ?? result.results.find(r => r.code)?.code ?? '',
        });
      }
      if (!this.confirmations.length) {
        const diagnostic = config.error;
        if (config.latestApplication !== previous) await this.control.fresh();
        await config.inspect();
        if (owner === this.selections()) owner?.refreshConfirmedCatalog(config);
        if (diagnostic && !this.detail) this.detail = diagnostic;
      }
    } catch (reason) { this.detail = errorText(reason); }
    finally { this.control.assignmentLocked = false; this.changed(); }
  }

  async selectProvider(agentId: string) {
    if (!this.available) return;
    const { config } = this.control;
    const owner = this.selections();
    this.control.assignmentLocked = true;
    this.detail = ''; this.confirmations = []; this.changed();
    try {
      const result = await config.selectProvider(agentId);
      if (!result) { this.detail = config.error; return; }
      if (!result.confirmed) {
        this.confirmations = result.confirmations ?? [];
        this.detail = result.reason || msg('config.requestFailed', { code: result.code ?? 'CONFIG_PROVIDER_REJECTED' });
        return;
      }
      if (!result.changed) return;
      await this.control.fresh();
      if (config.observedAgentId !== agentId) throw new HubError(msg('config.identityChanged'));
      await this.adoptProvider(owner);
    } catch (reason) { this.detail = errorText(reason); }
    finally { this.control.assignmentLocked = false; this.changed(); }
  }

  private async adoptProvider(owner: HubSelections | undefined) {
    const { config } = this.control;
    if (config.observedAgentId !== 'none') await config.inspect();
    if (owner === this.selections()) {
      owner?.synchronizeConfirmed(config, {}, config.actual?.current, config.catalog, true);
      owner?.refreshConfirmedCatalog(config);
    }
  }

  get continuationCommand() {
    const requirement = this.confirmations[0];
    if (requirement === 'release_provider_context_in_runner_terminal' || requirement === 'install_provider_in_runner_terminal') return '/provider';
    if (requirement === 'release_context_in_runner_terminal' || requirement === 'release_direct_context_in_runner_terminal') return '/clear';
    if (requirement === 'discard_staged_briefs_in_runner_terminal') return '/run-mode';
  }

  get continuationEnabled() {
    const command = flattenCommands(this.control.snapshot.observation?.commands ?? [])
      .find(candidate => candidate.text === this.continuationCommand && candidate.visible);
    return this.available && !this.interactionBusy && !!command?.enabled && !!this.control.snapshot.features?.interaction;
  }

  async openContinuation() {
    if (!this.continuationEnabled || !this.continuationCommand) return;
    const command = this.continuationCommand;
    const provider = this.control.config.observedAgentId;
    this.interactionBusy = true; this.interactionUnknown = false; this.detail = ''; this.changed();
    try {
      const attempt = await this.control.command(command);
      this.continuation = { command, attempt, provider };
      if (attempt.admission.state !== 'submitted') throw new HubError(msg('config.requestFailed', { code: attempt.admission.detail }));
      await this.readInteraction();
    } catch (reason) { this.detail = errorText(reason); }
    finally { this.interactionBusy = false; this.changed(); }
  }

  async respond(action: InteractionAction) {
    if (this.interactionBusy || this.interactionUnknown || !this.interaction?.actions.includes(action.action)
      || !this.continuation || this.continuation.attempt.state !== 'pending') return;
    const interaction_id = this.interaction.interaction_id;
    this.interaction = undefined;
    this.interactionBusy = true; this.changed();
    try {
      const receipt = await this.control.interaction({ operation: 'interaction.respond', interaction_id, ...action });
      if (receipt.state === 'outcome-unknown' || (record(receipt.reply) && receipt.reply.outcome_unknown)) {
        this.interactionUnknown = true;
        throw new HubError(msg('config.receiptUnknown'));
      }
      if (receipt.state !== 'accepted') this.detail = msg('config.requestFailed', { code: receipt.code ?? 'INTERACTION_REJECTED' });
      await this.readInteraction();
    } catch (reason) { this.detail = errorText(reason); }
    finally { this.interactionBusy = false; this.changed(); }
  }

  private async readInteraction() {
    const continuation = this.continuation;
    if (!continuation) return;
    const deadline = performance.now() + controlTiming.refreshMs;
    while (continuation.attempt.state === 'pending' && performance.now() < deadline) {
      if (this.control.snapshot.observation?.attention.foreground_interaction_active
        || continuation.attempt.result?.state === 'pending-interaction') {
        const receipt = await this.control.interaction({ operation: 'interaction.observe' });
        const view = record(receipt.reply) ? receipt.reply.interaction : undefined;
        if (record(view) && view.state === 'active') { this.interaction = view as Interaction; return; }
        if (receipt.state !== 'accepted' || (record(view) && view.state === 'unsupported')) {
          this.detail = msg('quick.unsupportedInteraction');
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, controlTiming.pollMs));
    }
    if (continuation.attempt.state === 'pending') {
      this.detail = msg('quick.interactionPending');
      return;
    }
    this.continuation = undefined;
    if (continuation.attempt.state === 'unknown') throw new HubError(msg('config.receiptUnknown'));
    const result = continuation.attempt.result;
    if (result?.state !== 'accepted' || result.ownerStatus === 'CANCELLED') {
      this.detail = msg('config.requestFailed', { code: result?.code ?? result?.ownerStatus ?? 'INTERACTION_CANCELLED' });
      return;
    }
    await this.control.fresh();
    if (continuation.provider !== this.control.config.observedAgentId) await this.adoptProvider(this.selections());
    else if (this.control.config.observedAgentId !== 'none') {
      const { config } = this.control;
      await config.inspect();
      if (continuation.command === '/clear' && config.actual?.current.target === '')
        this.selections()?.synchronizeConfirmed(config, { target: '' });
    }
    this.confirmations = [];
    this.detail = msg('quick.reviewAgain');
  }

  async refreshInteraction() {
    if (this.interactionBusy || this.interactionUnknown || !this.continuation) return;
    this.interactionBusy = true; this.changed();
    try { await this.readInteraction(); }
    catch (reason) { this.detail = errorText(reason); }
    finally { this.interactionBusy = false; this.changed(); }
  }

  get canRefreshInteraction() { return !!this.continuation && !this.interaction && !this.interactionUnknown; }
}
