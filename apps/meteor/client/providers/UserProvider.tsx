import type { IRoom, ISubscription, IUser } from '@rocket.chat/core-typings';
import { UserContext, LoginService, useSetting } from '@rocket.chat/ui-contexts';
import { Meteor } from 'meteor/meteor';
import React, { FC, useEffect, useMemo } from 'react';

import { Subscriptions, Rooms } from '../../app/models/client';
import { getUserPreference } from '../../app/utils/client';
import { callbacks } from '../../lib/callbacks';
import { useReactiveValue } from '../hooks/useReactiveValue';
import { createReactiveSubscriptionFactory } from '../lib/createReactiveSubscriptionFactory';
import { call } from '../lib/utils/call';

const getUserId = (): string | null => Meteor.userId();

const getUser = (): IUser | null => Meteor.user() as IUser | null;

const capitalize = (str: string): string => str.charAt(0).toUpperCase() + str.slice(1);

const config: Record<string, Partial<LoginService>> = {
	'facebook': { buttonColor: '#325c99' },
	'twitter': { buttonColor: '#02acec' },
	'google': { buttonColor: '#dd4b39' },
	'github': { buttonColor: '#4c4c4c', title: 'GitHub' },
	'github_enterprise': { buttonColor: '#4c4c4c', title: 'GitHub Enterprise' },
	'gitlab': { buttonColor: '#373d47', title: 'GitLab' },
	'trello': { buttonColor: '#026aa7' },
	'meteor-developer': { buttonColor: '#de4f4f', title: 'Meteor' },
	'wordpress': { buttonColor: '#1e8cbe', title: 'WordPress' },
	'linkedin': { buttonColor: '#1b86bc' },
};

const logout = (): Promise<void> =>
	new Promise((resolve, reject) => {
		const user = getUser();

		if (!user) {
			return resolve();
		}

		Meteor.logout(() => {
			callbacks.run('afterLogoutCleanUp', user);
			call('logoutCleanUp', user).then(resolve, reject);
		});
	});

type LoginMethods = keyof typeof Meteor;

const UserProvider: FC = ({ children }) => {
	const isLdapEnabled = Boolean(useSetting('LDAP_Enable'));
	const isCrowdEnabled = Boolean(useSetting('CROWD_Enable'));

	const userId = useReactiveValue(getUserId);
	const user = useReactiveValue(getUser);

	const loginMethod: LoginMethods = (isLdapEnabled && 'loginWithLDAP') || (isCrowdEnabled && 'loginWithCrowd') || 'loginWithPassword';

	useEffect(() => {
		if (isLdapEnabled && isCrowdEnabled) {
			if (process.env.NODE_ENV === 'development') {
				throw new Error('You can not use both LDAP and Crowd at the same time');
			}
			console.log('Both LDAP and Crowd are enabled. Please disable one of them.');
		}
		if (!Meteor[loginMethod]) {
			if (process.env.NODE_ENV === 'development') {
				throw new Error(`Meteor.${loginMethod} is not defined`);
			}
			console.log(`Meteor.${loginMethod} is not defined`);
		}
	}, [isLdapEnabled, isCrowdEnabled, loginMethod]);

	const contextValue = useMemo(
		() => ({
			userId,
			user,
			queryPreference: createReactiveSubscriptionFactory(
				<T,>(key: string, defaultValue?: T) => getUserPreference(userId, key, defaultValue) as T,
			),
			querySubscription: createReactiveSubscriptionFactory<ISubscription | undefined>((query, fields) =>
				Subscriptions.findOne(query, { fields }),
			),
			queryRoom: createReactiveSubscriptionFactory<IRoom | undefined>((query, fields) => Rooms.findOne(query, { fields })),
			querySubscriptions: createReactiveSubscriptionFactory<Array<ISubscription> | []>((query, options) =>
				(userId ? Subscriptions : Rooms).find(query, options).fetch(),
			),
			loginWithToken: (token: string): Promise<void> =>
				new Promise((resolve, reject) =>
					Meteor.loginWithToken(token, (err) => {
						if (err) {
							return reject(err);
						}
						resolve(undefined);
					}),
				),
			loginWithPassword: (user: string | object, password: string): Promise<void> =>
				new Promise((resolve, reject) => {
					Meteor[loginMethod](user, password, (error: Error | Meteor.Error | Meteor.TypedError | undefined) => {
						if (error) {
							reject(error);
							return;
						}

						resolve();
					});
				}),
			logout,
			loginWithService: <T extends LoginService>({ service, clientConfig = {} }: T): (() => Promise<true>) => {
				const loginMethods = {
					'meteor-developer': 'MeteorDeveloperAccount',
				};

				const loginWithService = `loginWith${(loginMethods as any)[service] || capitalize(String(service || ''))}`;

				const method: (config: unknown, cb: (error: any) => void) => Promise<true> = (Meteor as any)[loginWithService] as any;

				if (!method) {
					return () => Promise.reject(new Error('Login method not found'));
				}

				return () =>
					new Promise((resolve, reject) => {
						method(clientConfig, (error: any): void => {
							if (!error) {
								resolve(true);
								return;
							}
							reject(error);
						});
					});
			},
			queryAllServices: createReactiveSubscriptionFactory(() =>
				ServiceConfiguration.configurations
					.find(
						{
							showButton: { $ne: false },
						},
						{
							sort: {
								service: 1,
							},
						},
					)
					.fetch()
					.map(
						({ appId: _, ...service }) =>
							({
								title: capitalize(String((service as any).service || '')),
								...service,
								...(config[(service as any).service] ?? {}),
							} as any),
					),
			),
		}),
		[userId, user, loginMethod],
	);

	return <UserContext.Provider children={children} value={contextValue} />;
};

export default UserProvider;
