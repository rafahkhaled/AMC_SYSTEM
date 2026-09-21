import type { WhatsAppConversationView, WhatsAppMessageView, WhatsAppThread } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Empty, Loading } from '../../design/index.js';
import { conversations, handBack, reply, takeOver, thread } from './api.js';

/**
 * WhatsApp, from the practice's side (PW-08).
 *
 * Two panes: who is waiting, and what they said. The list is the screen that
 * earns its place — the practice's complaint is not that WhatsApp is hard to
 * read, it is that nobody knows which conversations are still owed an answer
 * and which the bot already dealt with.
 *
 * Nothing here decides anything the server also decides. Whether the reply box
 * works is `windowOpen` from the server, because that is Meta's twenty-four
 * hour rule and a box that disagrees with the API is worse than a disabled one.
 */
export function WhatsAppPage() {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['whatsapp', 'conversations'],
    queryFn: conversations,
    /*
     * Messages arrive while somebody is looking at the screen, and there is no
     * push channel to this browser. Thirty seconds is slow enough not to
     * matter and fast enough that a conversation does not sit unanswered
     * because nobody reloaded.
     */
    refetchInterval: 30_000,
  });

  return (
    <div className="u-stack">
      <Card title={t('whatsapp.title')} description={t('whatsapp.hint')}>
        {list.isLoading ? <Loading label={t('loading')} /> : null}
        {list.isError ? <Alert tone="error">{t('whatsapp.failed')}</Alert> : null}
        {list.data && list.data.length === 0 ? (
          <Empty title={t('whatsapp.none')} description={t('whatsapp.noneHint')} />
        ) : null}

        <div className="u-stack-tight">
          {(list.data ?? []).map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              open={conversation.id === openId}
              onOpen={() => setOpenId(conversation.id === openId ? null : conversation.id)}
            />
          ))}
        </div>
      </Card>

      {openId ? <Thread id={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

/** One line in the list: who, how long ago, and whether anybody holds it. */
function ConversationRow({
  conversation,
  open,
  onOpen,
}: {
  conversation: WhatsAppConversationView;
  open: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  /*
   * The client's name when it is known, the profile name when it is not, and
   * the number only as a last resort. A list of phone numbers is a list nobody
   * can act on without opening every row.
   */
  const who = conversation.clientName ?? conversation.profileName ?? conversation.phoneFormatted;

  return (
    <button
      type="button"
      className={`row row--button${open ? ' row--open' : ''}`}
      aria-expanded={open}
      onClick={onOpen}
    >
      <span className="row__main">
        <strong>{who}</strong>
        <span className="u-text-faint">{conversation.phoneFormatted}</span>
      </span>

      <span className="u-row u-row--tight">
        {conversation.unreadFromClient > 0 ? (
          <Badge tone="warning">
            {t('whatsapp.waiting', { count: conversation.unreadFromClient })}
          </Badge>
        ) : null}

        {conversation.handling === 'human' ? (
          // The person's name, not "with a person". Which person is the whole
          // question when somebody is deciding whether to pick it up.
          <Badge tone="accent">{conversation.assignedName ?? t('whatsapp.handling.human')}</Badge>
        ) : (
          <Badge tone="neutral">{t(`whatsapp.handling.${conversation.handling}`)}</Badge>
        )}

        {conversation.clientId ? null : <Badge tone="warning">{t('whatsapp.unmatched')}</Badge>}
      </span>
    </button>
  );
}

/** The thread, and the box for answering it. */
function Thread({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [draft, setDraft] = useState('');

  const open = useQuery({ queryKey: ['whatsapp', 'thread', id], queryFn: () => thread(id) });

  /*
   * Every write answers with the whole thread, so settling is a write of what
   * the server said rather than a guess followed by a refetch. The list is
   * invalidated too, because taking a conversation over changes how it reads
   * in the list behind this one.
   */
  const settle = (next: WhatsAppThread) => {
    queries.setQueryData(['whatsapp', 'thread', id], next);
    void queries.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
  };

  const send = useMutation({
    mutationFn: (body: string) => reply(id, body),
    onSuccess: (next) => {
      settle(next);
      setDraft('');
    },
  });
  const take = useMutation({ mutationFn: () => takeOver(id), onSuccess: settle });
  const give = useMutation({ mutationFn: () => handBack(id), onSuccess: settle });

  if (open.isLoading) return <Loading label={t('loading')} />;
  if (open.isError || !open.data) return <Alert tone="error">{t('whatsapp.threadFailed')}</Alert>;

  const conversation = open.data.conversation;

  return (
    <Card
      title={conversation.clientName ?? conversation.profileName ?? conversation.phoneFormatted}
      description={conversation.phoneFormatted}
    >
      <div className="u-row">
        <Button small tone="quiet" onClick={onClose}>
          {t('whatsapp.closeThread')}
        </Button>

        {conversation.handling === 'human' ? (
          <Button small tone="quiet" busy={give.isPending} onClick={() => give.mutate()}>
            {t('whatsapp.handBack')}
          </Button>
        ) : (
          <Button small busy={take.isPending} onClick={() => take.mutate()}>
            {t('whatsapp.takeOver')}
          </Button>
        )}
      </div>

      {conversation.clientId ? null : <Alert tone="warning">{t('whatsapp.unmatchedHint')}</Alert>}

      {conversation.optedOut ? <Alert tone="info">{t('whatsapp.optedOut')}</Alert> : null}

      <ol className="thread">
        {open.data.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </ol>

      {conversation.windowOpen ? (
        <form
          className="u-stack-tight"
          onSubmit={(event) => {
            event.preventDefault();
            const body = draft.trim();
            if (body.length > 0) send.mutate(body);
          }}
        >
          <label className="field">
            <span className="field__label">{t('whatsapp.reply')}</span>
            <textarea
              className="field__input"
              rows={3}
              value={draft}
              maxLength={4096}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>

          {send.isError ? <Alert tone="error">{(send.error as Error).message}</Alert> : null}

          <div className="u-row">
            <Button type="submit" busy={send.isPending} disabled={draft.trim().length === 0}>
              {t('whatsapp.send')}
            </Button>
          </div>
        </form>
      ) : (
        /*
         * Meta's rule, explained rather than enforced silently. Somebody who
         * sees a disabled box with no reason assumes the system is broken and
         * sends the message from their own phone, which is the habit this
         * screen exists to replace.
         */
        <Alert tone="info">{t('whatsapp.windowClosed')}</Alert>
      )}
    </Card>
  );
}

function Message({ message }: { message: WhatsAppMessageView }) {
  const { t } = useTranslation();
  const mine = message.direction === 'outbound';

  return (
    <li className={`bubble bubble--${mine ? 'out' : 'in'}`}>
      {message.body ? <p className="bubble__body">{message.body}</p> : null}

      {message.mediaFilename && !message.body ? (
        <p className="bubble__body u-text-soft">{message.mediaFilename}</p>
      ) : null}

      <span className="bubble__foot u-text-faint">
        {/* Who said it. A blank sender on an outbound message is the bot, and
            that is the first thing anybody wants to know when reading back. */}
        {mine ? (message.sentByName ?? t('whatsapp.byTheBot')) : null}
        {mine && message.status === 'failed' ? ` · ${t('whatsapp.failedToSend')}` : null}
        {message.documentId ? ` · ${t('whatsapp.filed')}` : null}
      </span>
    </li>
  );
}
