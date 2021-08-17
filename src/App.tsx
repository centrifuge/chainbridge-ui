import React from 'react';
import { ThemeSwitcher } from '@chainsafe/common-theme';
import {
  CssBaseline,
  Router,
  ToasterProvider,
} from '@chainsafe/common-components';
import { Web3Provider } from '@chainsafe/web3-context';
import { utils } from 'ethers';
import Routes from './Components/Routes';
import { lightTheme } from './Themes/LightTheme';
import { ChainbridgeProvider } from './Contexts/ChainbridgeContext';
import AppWrapper from './Layouts/AppWrapper';
import { NetworkManagerProvider } from './Contexts/NetworkManagerContext';
import { chainbridgeConfig } from './chainbridgeConfig';
import '@chainsafe/common-theme/dist/font-faces.css';

const chains = process.env.REACT_APP_CHAINS as 'testnets' | 'mainnets';

const App = (): JSX.Element => {
  const tokens = chainbridgeConfig[chains]
    .filter(c => c.type === 'Ethereum')
    .reduce((tca, bc) => {
      if (bc.networkId) {
        return {
          ...tca,
          [bc.networkId]: bc.tokens,
        };
      }
      return tca;
    }, {});

  return (
    <ThemeSwitcher themes={{ light: lightTheme }}>
      <CssBaseline />
      <ToasterProvider autoDismiss>
        <Web3Provider
          tokensToWatch={tokens}
          networkIds={[5]}
          onboardConfig={{
            dappId: process.env.REACT_APP_BLOCKNATIVE_DAPP_ID,
            walletSelect: {
              wallets: [{ walletName: 'metamask', preferred: true }],
            },
            subscriptions: {
              network: network => network && console.log('chainId: ', network),
              balance: amount =>
                amount && console.log('balance: ', utils.formatEther(amount)),
            },
          }}
          checkNetwork={false}
          gasPricePollingInterval={120}
          gasPriceSetting="fast"
        >
          <NetworkManagerProvider>
            <ChainbridgeProvider>
              <Router>
                <AppWrapper>
                  <Routes />
                </AppWrapper>
              </Router>
            </ChainbridgeProvider>
          </NetworkManagerProvider>
        </Web3Provider>
      </ToasterProvider>
    </ThemeSwitcher>
  );
};

export default App;
