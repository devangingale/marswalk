# Sol-48 demo video script

Length: about 2 minutes 40 seconds. Seven scenes. Recorded at 1440x900 on https://sol48.vercel.app in the **Day** theme.

Before recording:
- Open https://sol48.vercel.app/?tab=explore and wait until the globe and the **Dust history** bar have loaded.
- Have `app/src/fixtures/plan.sample.json` ready in the file picker for scene 4.
- If the network blocks the 3D globe, record with **Offline** on; every scene works the same.
- Sound on, so the **Daylight beeper** tone in scene 6 is heard.

The walk starts and ends at the **Shelter** (the Habitat by default).

## Scene 1. The problem (0:00 to 0:15)

On screen: Explore tab, the whole Mars globe with the water-ice layer and site markers.

Click path: none. Slowly rotate the globe by dragging.

Narration:
> Astronauts on Mars will walk out from their habitat to do science. Every walk has hard limits: suit time, energy, radiation dose and daylight. Sol-48 plans a walk inside those limits, then lets the crew rehearse it.

## Scene 2. Choosing where to go (0:15 to 0:40)

On screen: Explore, left panel **Site finder**, then back to **Layers**.

Click path:
1. Left panel: **Site finder**.
2. Press the chip **Low radiation**.
3. Drag the **Protection** weight up; the ranked list reorders.
4. Left panel: **Layers**. Under **Whole planet**, open **Radiation** and tick **Estimated surface radiation dose**.

Narration:
> The globe stacks NASA orbital data: water ice, radiation, dust, terrain and caves. The site finder applies the hard landing rules, then ranks what is left. Here I favour low radiation and shelter, and the list reorders with the reason for each score.

## Scene 3. Current conditions and the site (0:40 to 1:00)

On screen: Explore, right panel **Now**, the **Dust history** bar, then the flight into Mount Sharp.

Click path:
1. Point at **Gale weather** and its age.
2. In **Dust history**, press **+1** twice.
3. Right panel: **Sample route**, **Corner loop**, **Show route**.

Narration:
> On the right, the latest Curiosity weather at Gale, with how old each reading is. Under the map, dust history from Mars Year 24 to 36. Now we fly into Mount Sharp, Gale crater: a four by four kilometre site with one-metre terrain.

## Scene 4. Planning the walk (1:00 to 1:35)

On screen: Plan tab, the site image, then the route and the right panel.

Click path:
1. Tab **Plan**. Wait for the site image.
2. Right panel: **Import**, choose `plan.sample.json`.
3. Point at **Stops**, then **Budget**: **Distance**, **Time**, **Climb**, **Energy**, **Radiation dose**, **Turn-back**.
4. Under **Pace**, drag the departure slider later, then back.
5. Close the left panel with the ‹ handle on the map edge.

Narration:
> In Plan, we load a walk to Boxwork ridge, a ridge of mineral veins. The planner routes over walkable ground and moved the stop thirty-six metres off unsafe terrain. The budget shows 1.3 kilometres, under an hour, 50 metres of climb, the energy and the radiation dose. The pace check compares the speed needed with the speed this terrain allows, and gives a back-by time with a thirty-minute reserve before sunset. The plan exports as one file the crew takes to Mars.

## Scene 5. Rehearsing the walk (1:35 to 2:00)

On screen: Walk tab, 3D terrain following the two walkers, both side panels.

Click path:
1. Tab **Walk**.
2. Press **Play** in the bar under the map.
3. Point at EV1 and EV2 on the map, then at the right panel **Remaining** bars.

Narration:
> Walk replays the plan on 3D terrain. Two astronauts, each with a position uncertainty, because there is no GPS on Mars. On the right: the next stop, and the time, energy and dose left. Under the map: temperature and time to sunset along the walk.

## Scene 6. Safety (2:00 to 2:25)

On screen: Walk, left panel **Safety**.

Click path:
1. Point at the warning ladder: **On pace**, and the distance and time to the **Shelter**.
2. Press **Turn sound on** under **Daylight beeper**.
3. Point at the relay line: **Habitat** live, **Earth** next pass, items queued, **Transmission simulated**.

Narration:
> The left panel is the safety panel. The warning ladder goes from on pace to behind pace, turn back, and return to shelter, always with the distance and time to the Shelter. The daylight beeper sounds as the back-by time nears. The habitat link is live; messages for Earth wait for the next real orbiter pass, computed from NASA SPICE data. Transmission here is simulated, and labelled so.

## Scene 7. Visor and SOS (2:25 to 2:40)

On screen: Visor tab, the helmet display over the terrain.

Click path:
1. Tab **Visor**.
2. Point at the warning ladder, **Heading**, **Next stop**, **Time remaining**.
3. Under **SOS**, pick **Suit fault** and hold **Hold 2 s to send SOS**. When the countdown appears, press **Cancel**.

Narration:
> Visor is the same walk as a helmet display: warning level, heading, next stop and time remaining. SOS takes a two-second hold and gives ten seconds to cancel, so it is not sent by accident. Sent, it reaches the habitat at once and queues for Earth. Plan the walk, rehearse it, and keep a way back to shelter.
