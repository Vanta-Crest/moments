/** Internal browser construction failure; never carries the provider exception. */
export class BrowserSetupFailure extends Error {
    constructor(readonly closeFailed: boolean) {
        super('Owned browser setup failed');
        this.name = 'BrowserSetupFailure';
    }
}
