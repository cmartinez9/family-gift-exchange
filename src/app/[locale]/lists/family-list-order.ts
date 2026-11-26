export function splitFamilyLists<T extends {id: string}>(members: readonly T[], recipientId: string | null) {
  const recipient = members.find(({id}) => id === recipientId);
  return {
    recipient,
    others: recipient ? members.filter(({id}) => id !== recipient.id) : members,
  };
}
