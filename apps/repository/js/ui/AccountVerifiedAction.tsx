import * as React from 'react';
import {useAccountUpgrader} from "../../../../web/js/ui/account_upgrade/AccountUpgrader";
import {useDialogManager} from "../../../../web/js/mui/dialogs/MUIDialogControllers";
import {NULL_FUNCTION} from "polar-shared/src/util/Functions";
import {Billing} from "polar-accounts/src/Billing";
import {deepMemo} from "../../../../web/js/react/ReactUtils";

export namespace AccountVerifiedAction {

    import V2Plan = Billing.V2Plan;

    export function useAccountVerifiedAction() {

        const accountUpgrade = useAccountUpgrader();
        const dialogs = useDialogManager();

        return React.useCallback((delegate: () => void) => {

            if (accountUpgrade?.required) {

                dialogs.confirm({
                    title: 'Account Upgraded Required',
                    subtitle: accountUpgrade.reason === 'storage' ?
                        <StorageWarning plan={accountUpgrade.plan}/> :
                        <WebCaptureWarning plan={accountUpgrade.plan}/>,
                    onAccept: NULL_FUNCTION
                })

            } else {
                delegate();
            }

        }, [accountUpgrade, dialogs]);

    }

    interface IProps {
        readonly plan: V2Plan;
    }

    export const WebCaptureWarning = deepMemo((props: IProps) => {
        return (
            <div>
                <p>
                    You've reached the limits of your plan and need to upgrade
                    to ${props.plan.level}
                </p>

                <p>
                    To continue you could either:
                </p>

                <ul>
                    <li>
                        Upgrade to ${props.plan.level} (which we'd really appreciate)
                    </li>
                    <li>
                        Delete some of your web captures so you're lower
                        than the limit.
                    </li>
                </ul>

            </div>
        )
    });

    export const StorageWarning = deepMemo((props: IProps) => {
        return (
            <div>
                <p>
                    You've reached the limits of your plan and need to upgrade
                    to ${props.plan.level}
                </p>

                <p>
                    To continue you could either:
                </p>

                <ul>
                    <li>
                        Upgrade to ${props.plan.level} (which we'd really appreciate)
                    </li>
                    <li>
                        Delete some of your files so that you're lower than the
                        storage limit.
                    </li>
                </ul>

            </div>
        )
    });


}
