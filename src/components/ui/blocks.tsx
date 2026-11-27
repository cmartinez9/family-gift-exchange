import type {ReactNode} from "react";
import {Card} from "./card";
import {Icon} from "./icon";
import {KnitMotif} from "./knit/knit-motif";
import {LoadingPicture} from "./item-card";

/**
 * Nothing here yet: a soft knitted gift on the ground, then the one thing to do now on a gold card.
 * Gold is the one surface that needs you, so an empty state's action is the screen's next step.
 */
export function EmptyBlock({title, children, actions, motif = true, titleAs: Title = "h2"}: {
  title: ReactNode; children?: ReactNode; actions?: ReactNode; motif?: boolean; titleAs?: "h2" | "h3";
}) {
  return (
    <div className="flex flex-col items-center gap-6" data-block="empty">
      {motif && <KnitMotif name="gift" cell={8} colors={{"#": "rgba(255,248,239,.5)", o: "rgba(237,180,62,.8)"}} />}
      <Card tone="next" className="w-full">
        <Title className="text-section">{title}</Title>
        {children && <div className="pt-0.5 pb-3 text-body text-gold-ink">{children}</div>}
        {actions && <div className="flex flex-col gap-2">{actions}</div>}
      </Card>
    </div>
  );
}

/**
 * Waiting on something: the knit tile sweeps while the words say what is happening.
 * Saving is optimistic, so this sits where the thing will be.
 */
export function LoadingBlock({title, children}: {title: ReactNode; children?: ReactNode}) {
  return (
    <Card size="item" aria-busy="true" data-block="loading">
      <div className="flex items-center gap-3.5">
        <LoadingPicture />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5" role="status">
          <p className="text-item-title">{title}</p>
          {children && <p className="text-body text-muted-ink">{children}</p>}
        </div>
      </div>
    </Card>
  );
}

/**
 * Something went wrong and needs you: a gold card that names the problem in words, and the way out.
 * Like the refused PIN ("1958 looks like a year"): never a red alarm.
 */
export function ErrorBlock({title, children, action, live = true}: {
  title: ReactNode; children?: ReactNode; action?: ReactNode; live?: boolean;
}) {
  return (
    <Card tone="next" className="px-[18px] py-4" role={live ? "alert" : undefined} data-block="error">
      {/* at the largest text size the icon sits over the words, which keep the card's width */}
      <div className="flex items-start gap-3 max-[299px]:flex-col max-[299px]:gap-2">
        <Icon name="alert" size={24} strokeWidth={2.4} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-card-title">{title}</p>
          {children && <p className="text-body text-gold-ink">{children}</p>}
        </div>
      </div>
      {action && <div className="pt-3.5">{action}</div>}
    </Card>
  );
}
