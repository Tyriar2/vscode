/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { IWindowService } from 'vs/platform/windows/common/windows';
import * as nls from 'vs/nls';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { domEvent } from 'vs/base/browser/event';
import { Event } from 'vs/base/common/event';
import { IDisposable, toDisposable, dispose, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { getDomNodePagePosition, createStyleSheet, createCSSRule, append, $ } from 'vs/base/browser/dom';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Context } from 'vs/platform/contextkey/browser/contextKeyService';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { timeout } from 'vs/base/common/async';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { IWorkbenchActionRegistry, Extensions } from 'vs/workbench/common/actions';
import { IStorageService } from 'vs/platform/storage/common/storage';

export class InspectContextKeysAction extends Action {

	static readonly ID = 'workbench.action.inspectContextKeys';
	static LABEL = nls.localize('inspect context keys', "Inspect Context Keys");

	constructor(
		id: string,
		label: string,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWindowService private readonly windowService: IWindowService,
	) {
		super(id, label);
	}

	run(): Promise<void> {
		const disposables = new DisposableStore();

		const stylesheet = createStyleSheet();
		disposables.add(toDisposable(() => {
			if (stylesheet.parentNode) {
				stylesheet.parentNode.removeChild(stylesheet);
			}
		}));
		createCSSRule('*', 'cursor: crosshair !important;', stylesheet);

		const hoverFeedback = document.createElement('div');
		document.body.appendChild(hoverFeedback);
		disposables.add(toDisposable(() => document.body.removeChild(hoverFeedback)));

		hoverFeedback.style.position = 'absolute';
		hoverFeedback.style.pointerEvents = 'none';
		hoverFeedback.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
		hoverFeedback.style.zIndex = '1000';

		const onMouseMove = domEvent(document.body, 'mousemove', true);
		disposables.add(onMouseMove(e => {
			const target = e.target as HTMLElement;
			const position = getDomNodePagePosition(target);

			hoverFeedback.style.top = `${position.top}px`;
			hoverFeedback.style.left = `${position.left}px`;
			hoverFeedback.style.width = `${position.width}px`;
			hoverFeedback.style.height = `${position.height}px`;
		}));

		const onMouseDown = Event.once(domEvent(document.body, 'mousedown', true));
		onMouseDown(e => { e.preventDefault(); e.stopPropagation(); }, null, disposables);

		const onMouseUp = Event.once(domEvent(document.body, 'mouseup', true));
		onMouseUp(e => {
			e.preventDefault();
			e.stopPropagation();

			const context = this.contextKeyService.getContext(e.target as HTMLElement) as Context;
			console.log(context.collectAllValues());
			this.windowService.openDevTools();

			dispose(disposables);
		}, null, disposables);

		return Promise.resolve();
	}
}

export class ToggleScreencastModeAction extends Action {

	static readonly ID = 'workbench.action.toggleScreencastMode';
	static LABEL = nls.localize('toggle screencast mode', "Toggle Screencast Mode");

	static disposable: IDisposable | undefined;

	constructor(
		id: string,
		label: string,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		if (ToggleScreencastModeAction.disposable) {
			ToggleScreencastModeAction.disposable.dispose();
			ToggleScreencastModeAction.disposable = undefined;
			return;
		}

		const container = this.layoutService.getWorkbenchElement();

		const mouseMarker = append(container, $('div'));
		mouseMarker.style.position = 'absolute';
		mouseMarker.style.border = '2px solid red';
		mouseMarker.style.borderRadius = '20px';
		mouseMarker.style.width = '20px';
		mouseMarker.style.height = '20px';
		mouseMarker.style.top = '0';
		mouseMarker.style.left = '0';
		mouseMarker.style.zIndex = '100000';
		mouseMarker.style.content = ' ';
		mouseMarker.style.pointerEvents = 'none';
		mouseMarker.style.display = 'none';

		const onMouseDown = domEvent(container, 'mousedown', true);
		const onMouseUp = domEvent(container, 'mouseup', true);
		const onMouseMove = domEvent(container, 'mousemove', true);

		const mouseListener = onMouseDown(e => {
			mouseMarker.style.top = `${e.clientY - 10}px`;
			mouseMarker.style.left = `${e.clientX - 10}px`;
			mouseMarker.style.display = 'block';

			const mouseMoveListener = onMouseMove(e => {
				mouseMarker.style.top = `${e.clientY - 10}px`;
				mouseMarker.style.left = `${e.clientX - 10}px`;
			});

			Event.once(onMouseUp)(() => {
				mouseMarker.style.display = 'none';
				mouseMoveListener.dispose();
			});
		});

		const keyboardMarker = append(container, $('div'));
		keyboardMarker.style.position = 'absolute';
		keyboardMarker.style.backgroundColor = 'rgba(0, 0, 0 ,0.5)';
		keyboardMarker.style.width = '100%';
		keyboardMarker.style.height = '100px';
		keyboardMarker.style.bottom = '20%';
		keyboardMarker.style.left = '0';
		keyboardMarker.style.zIndex = '100000';
		keyboardMarker.style.pointerEvents = 'none';
		keyboardMarker.style.color = 'white';
		keyboardMarker.style.lineHeight = '100px';
		keyboardMarker.style.textAlign = 'center';
		keyboardMarker.style.fontSize = '56px';
		keyboardMarker.style.display = 'none';

		const onKeyDown = domEvent(container, 'keydown', true);
		let keyboardTimeout: IDisposable = Disposable.None;

		let enterChord = false;

		const keyboardListener = onKeyDown(e => {
			keyboardTimeout.dispose();

			const event = new StandardKeyboardEvent(e);
			const keybinding = this.keybindingService.resolveKeyboardEvent(event);
			const [firstPart,] = keybinding.getDispatchParts();

			if (firstPart !== null) {
				const shortcut = this.keybindingService.softDispatch(event, event.target);
				const label = keybinding.getLabel();

				if (shortcut) {
					if (enterChord) {
						keyboardMarker.textContent += ' ' + label;
					} else {
						keyboardMarker.textContent = label;
					}
					keyboardMarker.style.display = 'block';
					enterChord = shortcut.enterChord;
				} else if (!this.configurationService.getValue<boolean>('screencastMode.onlyKeyboardShortcuts')) {
					if (this.keybindingService.mightProducePrintableCharacter(event) && label) {
						keyboardMarker.textContent += ' ' + label;
						keyboardMarker.style.display = 'block';
					} else {
						keyboardMarker.textContent = label;
						keyboardMarker.style.display = 'block';
					}
					enterChord = false;
				}
			}

			const promise = timeout(800);
			keyboardTimeout = toDisposable(() => promise.cancel());

			promise.then(() => {
				keyboardMarker.textContent = '';
				keyboardMarker.style.display = 'none';
			});
		});

		ToggleScreencastModeAction.disposable = toDisposable(() => {
			mouseListener.dispose();
			keyboardListener.dispose();
			mouseMarker.remove();
			keyboardMarker.remove();
		});
	}
}

export class LogStorageAction extends Action {

	static readonly ID = 'workbench.action.logStorage';
	static LABEL = nls.localize({ key: 'logStorage', comment: ['A developer only action to log the contents of the storage for the current window.'] }, "Log Storage Database Contents");

	constructor(
		id: string,
		label: string,
		@IStorageService private readonly storageService: IStorageService,
		@IWindowService private readonly windowService: IWindowService
	) {
		super(id, label);
	}

	run(): Promise<void> {
		this.storageService.logStorage();

		return this.windowService.openDevTools();
	}
}

const developerCategory = nls.localize('developer', "Developer");
const registry = Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions);
registry.registerWorkbenchAction(new SyncActionDescriptor(InspectContextKeysAction, InspectContextKeysAction.ID, InspectContextKeysAction.LABEL), 'Developer: Inspect Context Keys', developerCategory);
registry.registerWorkbenchAction(new SyncActionDescriptor(ToggleScreencastModeAction, ToggleScreencastModeAction.ID, ToggleScreencastModeAction.LABEL), 'Developer: Toggle Screencast Mode', developerCategory);
registry.registerWorkbenchAction(new SyncActionDescriptor(LogStorageAction, LogStorageAction.ID, LogStorageAction.LABEL), 'Developer: Log Storage Database Contents', developerCategory);