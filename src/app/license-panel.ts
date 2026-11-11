// The free edition has no licence screen. The Pro overlay replaces this file.

import type { Post } from "../engine/license-online";
import type { StudioHost } from "./host";
import type { LicenseManager } from "./license-manager";

export function pickLicenseFile(_onText: (text: string) => void): void {}

export function renderLicensePanel(_container: HTMLElement, _license: LicenseManager, _host: Pick<StudioHost, "openUrl">, _post: Post): void {}
