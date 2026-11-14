/** Ids and names for the gold private jet (goldJetPlan), kept free of imports so the panel and router stay light. */
export const GOLD_JET_KEY='service:atlas-gold-jet';
export const GOLD_JET_ID='atlas-gold-jet';
export const GOLD_JET_NAME='Atlas Gold Jet';
/** Office id shared by the "Enter aircraft" button and the interior route. */
export const GOLD_JET_OFFICE_ID='skyline-business:Atlas Gold Jet';
/** Unnamed passengers: the same people walk the jet bridge and sit inside. */
export const GOLD_JET_PASSENGERS=6;
/**
 * Riding the gold jet: while "Enter aircraft" is open the map keeps drawing and its camera rides with the jet, looking
 * into the open cabin (or out of a window seat). The overlay's drags and wheel turn and zoom that view here.
 */
export const goldJetRide={active:false,view:'cutaway' as 'cutaway'|'window',yaw:0,pitch:0,zoom:1};
