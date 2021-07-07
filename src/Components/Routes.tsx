import React from 'react';
import TransferPage from './Pages/TransferPage';

export const ROUTE_LINKS = {
  Transfer: '/transfer',
  Wrap: '/wrap',
  Explore: '/explore',
};

const FilesRoutes = (): JSX.Element => <TransferPage />;

export default FilesRoutes;
