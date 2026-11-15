import { useMemo } from 'react';
import { parseStoryReading } from './storyReading';

export function StoryReading({ narrative, protagonistName }: { narrative: string; protagonistName: string }) {
  const blocks = useMemo(() => parseStoryReading(narrative, protagonistName), [narrative, protagonistName]);
  return <div className="story-reading">
    {blocks.map((block, index) => block.kind === 'dialogue' ? (
      <div className={`story-dialogue${block.isProtagonist ? ' story-dialogue-hero' : ''}`} key={index}>
        <span className="avatar story-avatar" aria-hidden="true">{Array.from(block.speaker)[0]}</span>
        <div className="story-speech">
          <p className="story-speaker">{block.speaker}</p>
          <p className="prose story-bubble">{block.text.trim()}</p>
        </div>
      </div>
    ) : <p className="prose story-narration" key={index}>{block.kind === 'plain' ? block.text : block.text.trim()}</p>)}
  </div>;
}
