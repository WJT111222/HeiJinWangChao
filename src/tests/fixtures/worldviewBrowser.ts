import { SaveRepository } from '../../services/storage/saveRepository';
import { WorldbookLibrary } from '../../services/storage/worldbookLibrary';
import { parseBackup, serializeBackup } from '../../services/storage/backup';
import { createTurnDraft } from '../../domain/drafts';
import { StoryStage } from '../../workflows/storyStage';
import { VariableStage } from '../../workflows/variableStage';
import { WorldStage } from '../../workflows/worldStage';
import { defaultAiConfig, newChannel, saveAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { defaultSettings, settingsKey } from '../../ui/settings/model';
import { officialIds } from '../../domain/worldbook/mainWorldbook';
import { worldState } from './world';
import { submission } from './turn';

let activeStory: StoryStage | undefined;
export const cancelStory = () => activeStory?.cancel();

export async function book(marker: string) {
  const opened = await WorldbookLibrary.open();
  if (!opened.ok) throw Error('无法打开书库');
  const lib = opened.library;
  try {
    for (const id of officialIds) await lib.setOfficial(id, false);
    const blank = await lib.createBook(marker);
    if (!blank.ok) throw Error('无法创建测试书');
    const { bookId, versionId } = blank.release;
    if (
      !(
        await lib.reviseBook(
          bookId,
          { purpose: 'main', add: [{ entryId: 'marker', constant: true, content: marker }] },
          { baseVersionId: versionId },
        )
      ).ok ||
      !(await lib.setEnabled(bookId, true)).ok
    )
      throw Error('无法启用测试书');
    return bookId;
  } finally {
    lib.close();
  }
}

export async function action(
  op:
    | 'seed'
    | 'export'
    | 'import'
    | 'view'
    | 'story'
    | 'variables'
    | 'world'
    | 'commit'
    | 'continue'
    | 'delete'
    | 'replace'
    | 'configure'
    | 'bookmark'
    | 'restore'
    | 'undo'
    | 'bind',
  backup?: string,
  id = 'save-a',
) {
  const repo = await SaveRepository.open();
  try {
    if (op === 'seed') {
      const state = await repo.create({ ...worldState(), saveId: id });
      return await repo.saveDraft(createTurnDraft(id, state.revision, 'same-turn', 'opening', '去用餐'), null);
    }
    if (op === 'export') return await serializeBackup(await repo.exportBackup([id]), 'beta');
    if (op === 'import') {
      const entry = (await parseBackup(backup!)).entries[0];
      if (!entry.ok || !entry.draft) throw Error('导入的测试草稿无效');
      const check = await repo.compareBackup(entry);
      return await repo.importBackup(entry, check.confirmation, { overwrite: true });
    }
    const game = await repo.loadGame(id);
    if (op === 'view') return game;
    if (op === 'delete') return await repo.delete(id, game.state.revision, game.instance);
    const draft = game.draft!;
    if (op === 'bind') return await repo.bindTurnAction(draft, backup!, true, true);
    if (op === 'bookmark') return (await repo.history.create(id, '同一份初始状态')).id;
    if (op === 'restore')
      return await repo.history.restore(
        (await repo.history.preview(id, { kind: 'manual', id: backup! })).confirmation,
        '去车站',
        true,
        true,
      );
    if (op === 'undo')
      return await repo.undoTurn({
        saveId: id,
        expectedRevision: game.state.revision,
        expectedDraft: draft,
        operationId: 'source-undo',
      });
    if (op === 'commit') return await repo.commitTurn(submission(draft));
    const config = defaultAiConfig(),
      channel = newChannel('openai');
    channel.baseUrl = 'https://worldview-source.mock.invalid/v1';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['variables', 'world'] as const)
      config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    const vault = new CredentialVault(sessionStorage, localStorage);
    vault.set(channel.id, 'mock-source-key');
    const settings = defaultSettings();
    settings.prompts.actionOptions = false;
    settings.prompts.minNarrativeChars = 5;
    settings.runtime.streamStory = settings.runtime.streamVariables = settings.runtime.streamWorld = false;
    if (op === 'configure') {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      saveAiConfig(localStorage, config);
      return;
    }
    const input = { draft, settings, config, vault };
    if (op === 'story' || op === 'continue' || op === 'replace') {
      activeStory = new StoryStage(repo);
      try {
        return await activeStory.generate({
          ...input,
          continuation: op === 'continue',
          freshWorldview: op === 'replace',
          onFailureSaved: () => {},
        });
      } finally {
        activeStory = undefined;
      }
    }
    if (op === 'variables') return await new VariableStage(repo).generate(input);
    return await new WorldStage(repo).generate(input);
  } finally {
    repo.close();
  }
}
