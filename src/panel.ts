// SPDX-License-Identifier: MIT
/**
 * The only code that changes GNOME Shell's top bar.
 *
 * @packageDocumentation
 */

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** The panel's centre and right boxes, which GNOME Shell keeps private. */
export interface PanelBoxes {
    /** Box that holds the clock by default. */
    readonly center: St.BoxLayout;
    /** Box that ends with the system menu. */
    readonly right: St.BoxLayout;
}

/**
 * Look up the private panel boxes, verifying their types at runtime.
 *
 * @returns The boxes, or null when GNOME Shell's internals differ.
 */
export function panelBoxes(): PanelBoxes | null {
    const center: unknown = Reflect.get(Main.panel, '_centerBox');
    const right: unknown = Reflect.get(Main.panel, '_rightBox');
    return center instanceof St.BoxLayout && right instanceof St.BoxLayout ? {center, right} : null;
}

/** Applies the notch layout to the top bar and reverts it exactly. */
export class PanelLayout {
    /** Whether {@link PanelLayout.apply} has changed the bar since the last restore. */
    #applied = false;
    /** The clock's index in the centre box before it moved, or -1. */
    #clockIndex = -1;

    /**
     * Fix the bar height and move the clock beside the system menu.
     *
     * @remarks
     * The height is set on the actor, not in its style, because GNOME Shell's
     * overview owns `Main.panel.style` and clears it at startup and on every hide.
     *
     * @param stageHeight - Bar height in stage units.
     */
    apply(stageHeight: number): void {
        Main.panel.set_height(stageHeight);
        this.#moveClock();
        this.#applied = true;
    }

    /** Revert every change made by {@link PanelLayout.apply}; repeated calls do nothing. */
    restore(): void {
        if (!this.#applied) {
            return;
        }
        const clock = Main.panel.statusArea.dateMenu?.container;
        const boxes = panelBoxes();
        if (clock && boxes && this.#clockIndex >= 0 && clock.get_parent() === boxes.right) {
            boxes.right.remove_child(clock);
            boxes.center.insert_child_at_index(
                clock,
                Math.min(this.#clockIndex, boxes.center.get_n_children()),
            );
        }
        this.#clockIndex = -1;
        Main.panel.set_height(-1);
        this.#applied = false;
    }

    /** Move the clock from the centre box to just left of the system menu. */
    #moveClock(): void {
        const clock = Main.panel.statusArea.dateMenu?.container;
        const boxes = panelBoxes();
        if (!boxes || clock?.get_parent() !== boxes.center) {
            return;
        }
        this.#clockIndex = boxes.center.get_children().indexOf(clock);
        boxes.center.remove_child(clock);
        boxes.right.insert_child_at_index(clock, Math.max(boxes.right.get_n_children() - 1, 0));
    }
}
