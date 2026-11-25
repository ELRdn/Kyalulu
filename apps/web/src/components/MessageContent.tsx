import MarkdownView from './MarkdownView';
import { MessageLayout, type MessageContentProps } from './MessageLayout';

export { Narration, UserText } from './MessageLayout';

export default function MessageContent(props: MessageContentProps) {
  return <MessageLayout {...props} Markdown={MarkdownView} />;
}
