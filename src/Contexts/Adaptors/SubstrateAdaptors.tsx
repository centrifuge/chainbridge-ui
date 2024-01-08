import React, { useCallback, useEffect, useState } from 'react';
import { ApiPromise } from '@polkadot/api';
import * as Sentry from '@sentry/react';
import {
  web3Accounts,
  web3Enable,
  web3FromSource,
} from '@polkadot/extension-dapp';
import { TypeRegistry } from '@polkadot/types';
import { Tokens } from '@chainsafe/web3-context/dist/context/tokensReducer';
import { BigNumber as BN } from 'bignumber.js';
import { UnsubscribePromise, VoidFn } from '@polkadot/api/types';
import { BigNumber, ethers, utils } from 'ethers';
import { BridgeFactory } from '@chainsafe/chainbridge-contracts';
import {
  IDestinationBridgeProviderProps,
  IHomeBridgeProviderProps,
  InjectedAccountType,
} from './interfaces';
import { createApi, submitDeposit } from './SubstrateApis/ChainBridgeAPI';
import { useNetworkManager } from '../NetworkManagerContext';
import { HomeBridgeContext } from '../HomeBridgeContext';
import { DestinationBridgeContext } from '../DestinationBridgeContext';
import {
  chainbridgeConfig,
  EvmBridgeConfig,
  SubstrateBridgeConfig,
} from '../../chainbridgeConfig';

export const SubstrateHomeAdaptorProvider = ({
  children,
}: IHomeBridgeProviderProps): JSX.Element => {
  const registry = new TypeRegistry();
  const [api, setApi] = useState<ApiPromise | undefined>();
  const [isReady, setIsReady] = useState(false);
  const [accounts, setAccounts] = useState<InjectedAccountType[]>([]);
  const [address, setAddress] = useState<string | undefined>(undefined);

  const {
    homeChainConfig,
    setTransactionStatus,
    setDepositNonce,
    handleSetHomeChain,
    homeChains,
  } = useNetworkManager();

  const [relayerThreshold, setRelayerThreshold] = useState<number | undefined>(
    undefined,
  );
  const [bridgeFee, setBridgeFee] = useState<number | undefined>(undefined);

  const [depositAmount, setDepositAmount] = useState<number | undefined>();
  const [selectedToken, setSelectedToken] = useState<string>('CSS');

  const [tokens, setTokens] = useState<Tokens>({});

  const chains = import.meta.env.VITE_CHAINS as 'testnets' | 'mainnets';

  const ss58Format = chains === 'mainnets' ? 36 : undefined;

  const handleConnect = useCallback(async () => {
    // Requests permission to inject the wallet
    if (!isReady) {
      web3Enable('chainbridge-ui')
        .then(() => {
          // web3Account resolves with the injected accounts
          // or an empty array
          web3Accounts({ ss58Format })
            .then(accounts =>
              accounts.map(({ address, meta }) => ({
                address,
                meta: {
                  ...meta,
                  name: `${meta.name} (${meta.source})`,
                },
              })),
            )
            .then(injectedAccounts => {
              // This is where the correct chain configuration is set to the network context
              // Any operations before presenting the accounts to the UI or providing the config
              // to the rest of the dapp should be done here
              setAccounts(injectedAccounts);
              if (injectedAccounts.length === 1) {
                setAddress(injectedAccounts[0].address);
              }
              handleSetHomeChain(
                homeChains.find(item => item.type === 'Substrate')?.chainId,
              );
            })
            .catch(console.error);
        })
        .catch(console.error);
    }
  }, [isReady, handleSetHomeChain, homeChains, ss58Format]);

  useEffect(() => {
    // Attempt connect on load
    handleConnect();
  }, [handleConnect]);

  const [initiaising, setInitialising] = useState(false);
  useEffect(() => {
    // Once the chain ID has been set in the network context, the homechain configuration will be automatically set thus triggering this
    if (!homeChainConfig || initiaising || api) return;
    setInitialising(true);
    createApi(homeChainConfig.rpcUrl)
      .then(api => {
        setApi(api);
        setInitialising(false);
      })
      .catch(error => {
        console.error(error);
        setInitialising(false);
      });
  }, [homeChainConfig, registry, api, initiaising]);

  const getRelayerThreshold = useCallback(async () => {
    if (api) {
      const ethChain = chainbridgeConfig[chains].find(
        chain => chain.type === 'Ethereum',
      ) as EvmBridgeConfig;

      const { bridgeAddress, networkId, rpcUrl } = ethChain;

      let provider;

      if (rpcUrl.startsWith('wss')) {
        const parts = rpcUrl.split('/');

        provider = new ethers.providers.InfuraWebSocketProvider(
          networkId,
          parts[parts.length - 1],
        );
      } else {
        provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      }

      const bridge = BridgeFactory.connect(bridgeAddress, provider);

      const threshold = BigNumber.from(
        await bridge._relayerThreshold(),
      ).toNumber();

      setRelayerThreshold(threshold);
    }
  }, [api, chains]);

  const getBridgeFee = useCallback(async () => {
    if (api) {
      const config = homeChainConfig as SubstrateBridgeConfig;

      let fee;

      if (config.bridgeFeeFunctionName) {
        fee = new BN(
          Number(
            await api.query[config.transferPalletName][
              config.bridgeFeeFunctionName
            ](),
          ),
        )
          .shiftedBy(-config.decimals)
          .toNumber();
      } else {
        fee = config.bridgeFeeValue || 0;
      }

      setBridgeFee(fee);
    }
  }, [api, homeChainConfig]);

  const confirmChainID = useCallback(async () => {
    if (api) {
      const currentId = Number(
        api.consts[
          (homeChainConfig as SubstrateBridgeConfig).chainbridgePalletName
        ].chainIdentity.toHuman(),
      );
      if (homeChainConfig?.chainId !== currentId) {
        const correctConfig = homeChains.find(
          item => item.chainId === currentId,
        );
        if (correctConfig) {
          handleSetHomeChain(currentId);
        }
      }
    }
  }, [api, handleSetHomeChain, homeChainConfig, homeChains]);

  useEffect(() => {
    // For all constants & essential values like:
    // Relayer Threshold, resources IDs & Bridge Fees
    // It is recommended to collect state at this point
    if (api) {
      if (api.isConnected && homeChainConfig) {
        getRelayerThreshold();
        confirmChainID();
        getBridgeFee();
      }
    }
  }, [api, getRelayerThreshold, getBridgeFee, confirmChainID, homeChainConfig]);

  useEffect(() => {
    if (!homeChainConfig || !address) return;
    let unsubscribe: VoidFn | undefined;
    if (api) {
      api.query.system
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .account(address, (result: any) => {
          const { data } = result.toJSON();

          const frozen = parseFloat(
            utils.formatUnits(data.frozen, homeChainConfig.decimals),
          );

          const balance = parseFloat(
            utils.formatUnits(data.free, homeChainConfig.decimals),
          );

          const free = balance - frozen;

          const freeBalance = free > 0 ? free : 0;

          setTokens({
            [homeChainConfig.tokens[0].symbol || 'TOKEN']: {
              decimals: homeChainConfig.decimals,
              balance: freeBalance,
              balanceBN: new BN(freeBalance).shiftedBy(
                -homeChainConfig.decimals,
              ),
              name: homeChainConfig.tokens[0].name,
              symbol: homeChainConfig.tokens[0].symbol,
            },
          });
        })
        .then(unsub => {
          // @ts-expect-error
          unsubscribe = unsub;
        })
        .catch(console.error);
    }
    return () => {
      unsubscribe && unsubscribe();
    };
  }, [api, address, homeChainConfig]);

  useEffect(() => {
    // This is a simple check
    // The reason for having a isReady is that the UI can lazy load data from this point
    api?.isReady.then(() => setIsReady(true));
  }, [api, setIsReady]);

  const selectAccount = useCallback(
    (index: number) => {
      setAddress(accounts[index].address);
    },
    [accounts],
  );

  const deposit = useCallback(
    async (
      amount: number,
      recipient: string,
      tokenAddress: string,
      destinationChainId: number,
    ) => {
      if (api && address) {
        const allAccounts = await web3Accounts({ ss58Format });

        const targetAccount = allAccounts.find(
          item => item.address === address,
        );
        if (targetAccount) {
          const transferExtrinsic = submitDeposit(
            api,
            amount,
            recipient,
            destinationChainId,
          );

          const injector = await web3FromSource(targetAccount.meta.source);
          setTransactionStatus('Initializing Transfer');
          setDepositAmount(amount);
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          transferExtrinsic
            .signAndSend(
              address,
              { signer: injector.signer },
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-expect-error
              ({ status, events }) => {
                status.isInBlock &&
                  console.log(
                    `Completed at block hash #${status.isInBlock.toString()}`,
                  );

                if (status.isFinalized) {
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-expect-error
                  events.filter(({ event }) =>
                    api.events[
                      (homeChainConfig as SubstrateBridgeConfig)
                        .chainbridgePalletName
                    ].FungibleTransfer.is(event),
                  );
                  api.query[
                    (homeChainConfig as SubstrateBridgeConfig)
                      .chainbridgePalletName
                  ]
                    .chainNonces(destinationChainId)
                    .then(response => {
                      setDepositNonce(`${response.toJSON()}`);
                      setTransactionStatus('In Transit');
                    })
                    .catch(error => {
                      console.error(error);
                    });
                } else {
                  console.log(`Current status: ${status.type}`);
                }
              },
            )
            .catch((error: unknown) => {
              console.log(':( transaction failed', error);
              Sentry.captureException(error);
              setTransactionStatus('Transfer Aborted');
            });
        }
      }
    },
    [
      api,
      setDepositNonce,
      setTransactionStatus,
      address,
      homeChainConfig,
      ss58Format,
    ],
  );

  // Required for adaptor however not needed for substrate
  const wrapToken = async (): Promise<string> => 'Not implemented';

  // Required for adaptor however not needed for substrate
  const unwrapToken = async (): Promise<string> => 'Not implemented';

  return (
    <HomeBridgeContext.Provider
      value={{
        connect: handleConnect,
        disconnect: async () => {
          await api?.disconnect();
        },
        getNetworkName: () => homeChainConfig?.name || 'undefined',
        bridgeFee,
        deposit,
        depositAmount,
        selectedToken,
        setDepositAmount,
        setSelectedToken,
        tokens,
        relayerThreshold,
        wrapTokenConfig: undefined, // Not implemented
        wrapper: undefined, // Not implemented
        wrapToken, // Not implemented
        unwrapToken, // Not implemented
        isReady,
        chainConfig: homeChainConfig,
        address,
        nativeTokenBalance: 0,
        accounts,
        selectAccount,
      }}
    >
      {children}
    </HomeBridgeContext.Provider>
  );
};

export const SubstrateDestinationAdaptorProvider = ({
  children,
}: IDestinationBridgeProviderProps): JSX.Element => {
  const {
    depositNonce,
    destinationChainConfig,
    setDepositVotes,
    depositVotes,
    tokensDispatch,
    setTransactionStatus,
    setTransferTxHash,
  } = useNetworkManager();

  const [api, setApi] = useState<ApiPromise | undefined>();

  const [initiaising, setInitialising] = useState(false);
  useEffect(() => {
    // Once the chain ID has been set in the network context, the destination configuration will be automatically
    // set thus triggering this
    if (!destinationChainConfig || initiaising || api) return;
    setInitialising(true);
    createApi(destinationChainConfig.rpcUrl)
      .then(api => {
        setApi(api);
        setInitialising(false);
      })
      .catch(console.error);
  }, [destinationChainConfig, api, initiaising]);

  const [listenerActive, setListenerActive] = useState<
    UnsubscribePromise | undefined
  >(undefined);

  useEffect(() => {
    if (api && !listenerActive && depositNonce) {
      // Wire up event listeners
      // Subscribe to system events via storage
      // @ts-expect-error
      const unsubscribe = api.query.system.events(events => {
        console.log(`----- Received ${events.length} event(s): -----`);
        // loop through the Vec<EventRecord>
        // @ts-expect-error
        events.forEach(record => {
          // extract the phase, event and the event types
          const { event, phase } = record;
          const types = event.typeDef;
          // show what we are busy with
          console.log(
            `${event.section}:${event.method}::phase=${phase.toString()}`,
          );
          // loop through each of the parameters, displaying the type and data
          // @ts-expect-error
          event.data.forEach((data, index) => {
            console.log(`${types[index].type};${data.toString()}`);
          });

          if (
            event.section ===
              (destinationChainConfig as SubstrateBridgeConfig)
                .chainbridgePalletName &&
            event.method === 'VoteFor'
          ) {
            setDepositVotes(depositVotes + 1);
            tokensDispatch({
              type: 'addMessage',
              payload: {
                address: 'Substrate Relayer',
                signed: 'Confirmed',
              },
            });
          }

          if (
            event.section ===
              (destinationChainConfig as SubstrateBridgeConfig)
                .chainbridgePalletName &&
            event.method === 'ProposalApproved'
          ) {
            setTransferTxHash(event.hash.toString());
            setDepositVotes(depositVotes + 1);
            setTransactionStatus('Transfer Completed');
          }
        });
      });
      // @ts-expect-error
      setListenerActive(unsubscribe);
    } else if (listenerActive && !depositNonce) {
      const unsubscribeCall = async () => {
        setListenerActive(undefined);
      };
      unsubscribeCall();
    }
  }, [
    api,
    depositNonce,
    depositVotes,
    destinationChainConfig,
    listenerActive,
    setDepositVotes,
    setTransactionStatus,
    setTransferTxHash,
    tokensDispatch,
  ]);

  return (
    <DestinationBridgeContext.Provider
      value={{
        disconnect: async () => {
          await api?.disconnect();
        },
      }}
    >
      {children}
    </DestinationBridgeContext.Provider>
  );
};
