import { OwnersTabs } from '@/components/OwnersTabs';

export default function OwnersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OwnersTabs />
      {children}
    </>
  );
}
