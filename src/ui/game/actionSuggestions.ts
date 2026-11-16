import type { GameState } from '../../domain/state';

/** A display projection only: choosing a suggestion never authorizes a request. */
export function actionSuggestions(state: Pick<GameState, 'journal' | 'turnNumber'>, story?: GameState['journal'][number]['story']) {
  const current = story?.actionOptions;
  if (current && current.length >= 3 && current.length <= 5) {
    return { options: current, previous: false, label: '当前正文建议（本回合尚未结算）' };
  }
  const previous = state.journal.at(-1)?.story.actionOptions;
  if (previous && previous.length >= 3 && previous.length <= 5) {
    return { options: previous, previous: true, label: `上一已结算回合建议 · 第${state.turnNumber}回合` };
  }
}
