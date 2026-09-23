package com.gpt.decks.engine.president;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The authoritative President rules engine — a port of the Angular client's
 * engine (same logic, same tests). Server-authoritative: {@link GameState} is
 * plain serializable data; {@link #dispatch} is the only mutator and returns the
 * {@link GameEvent}s it produced (the STOMP broadcast payload); {@link #view}
 * redacts opponents' hands per player.
 *
 * <p>Single-writer: the per-game actor is the only caller, so no locking here.
 */
public final class PresidentEngine {

  private final GameState state;

  private PresidentEngine(GameState state) {
    this.state = state;
  }

  /** Fresh game: deal round one and seat the 3♣ holder as leader. */
  public static PresidentEngine newGame(List<String> playerIds, int seed, int numDecks) {
    if (playerIds.size() < 2) {
      throw new IllegalArgumentException("President needs at least 2 players");
    }
    int decks = Math.max(1, Math.min(4, numDecks));
    Rng rng = new Rng(seed);
    List<List<Card>> hands = Deck.deal(playerIds.size(), rng, decks);
    List<PlayerState> players = new ArrayList<>();
    for (int seat = 0; seat < playerIds.size(); seat++) {
      players.add(new PlayerState(playerIds.get(seat), seat, sortedHand(hands.get(seat))));
    }
    GameState s = new GameState();
    s.setRound(1);
    s.setDecks(decks);
    s.setPlayers(players);
    s.setTurn(firstLeaderSeat(players));
    s.setPhase(Phase.PLAYING);
    s.setRngState(rng.state());
    return new PresidentEngine(s);
  }

  public static PresidentEngine fromState(GameState state) {
    return new PresidentEngine(state);
  }

  public GameState state() {
    return state;
  }

  public Phase phase() {
    return state.getPhase();
  }

  public String currentPlayerId() {
    return state.getPlayers().get(state.getTurn()).getId();
  }

  /** Per-player redacted state: only {@code playerId} sees their own hand. */
  public GameState view(String playerId) {
    GameState v = new GameState();
    v.setRound(state.getRound());
    v.setDecks(state.getDecks());
    v.setTurn(state.getTurn());
    v.setTrick(state.getTrick());
    v.setFinishingOrder(state.getFinishingOrder());
    v.setBottomed(state.getBottomed());
    v.setPhase(state.getPhase());
    v.setPendingExchanges(state.getPendingExchanges());
    v.setStandings(state.getStandings());
    v.setRngState(0); // never expose the RNG to clients
    List<PlayerState> redacted = new ArrayList<>();
    for (PlayerState p : state.getPlayers()) {
      List<Card> hand;
      if (p.getId().equals(playerId)) {
        hand = new ArrayList<>(p.getHand());
      } else {
        // Hide identities but keep the count (the client renders N face-down cards).
        hand = new ArrayList<>();
        for (int i = 0; i < p.getHand().size(); i++) {
          hand.add(new Card(Rank.THREE, Suit.CLUBS, "hidden:" + p.getId() + ":" + i));
        }
      }
      PlayerState rp = new PlayerState(p.getId(), p.getSeat(), hand);
      rp.setPassed(p.isPassed());
      rp.setFinished(p.isFinished());
      rp.setRole(p.getRole());
      redacted.add(rp);
    }
    v.setPlayers(redacted);
    return v;
  }

  /** null when the action is legal, otherwise a human-readable reason. */
  public String validate(Action action) {
    if (action instanceof Action.Exchange ex) {
      if (state.getPhase() != Phase.EXCHANGE) {
        return "not exchanging cards now";
      }
      ExchangeDebt debt = findDebt(ex.playerId());
      if (debt == null) {
        return "you have no cards to pass";
      }
      if (ex.cardUids().size() != debt.count()) {
        return "choose exactly " + debt.count() + " card" + (debt.count() == 1 ? "" : "s");
      }
      PlayerState giver = player(ex.playerId());
      return resolveCards(giver, ex.cardUids()) != null ? null : "those cards are not in your hand";
    }
    if (state.getPhase() != Phase.PLAYING) {
      return "the round is not in play";
    }
    PlayerState p = state.getPlayers().get(state.getTurn());
    if (!action.playerId().equals(p.getId())) {
      return "not your turn";
    }
    if (action instanceof Action.Pass) {
      return state.getTrick().getTopCombo() == null ? "cannot pass when leading" : null;
    }
    Action.Play play = (Action.Play) action;
    List<Card> cards = resolveCards(p, play.cardUids());
    if (cards == null) {
      return "those cards are not in your hand";
    }
    Combo combo = Combo.resolve(cards);
    if (combo == null) {
      return "a play must be a single rank (7s may be wild)";
    }
    Combo top = state.getTrick().getTopCombo();
    if (top == null) {
      return null;
    }
    if (combo.isSingleTwo()) {
      return null;
    }
    return Combo.canFollow(top, combo) ? null : "must match the count and be equal or higher";
  }

  /** Apply an action; returns the events it produced. Throws if illegal. */
  public List<GameEvent> dispatch(Action action) {
    String reason = validate(action);
    if (reason != null) {
      throw new IllegalArgumentException("Illegal action: " + reason);
    }
    if (action instanceof Action.Exchange ex) {
      return applyExchange(ex);
    }
    List<GameEvent> events = new ArrayList<>();
    int seat = state.getTurn();
    PlayerState player = state.getPlayers().get(seat);

    if (action instanceof Action.Pass) {
      player.setPassed(true);
      events.add(new GameEvent.Passed(player.getId()));
      afterPass(seat, events);
      return events;
    }

    Action.Play play = (Action.Play) action;
    List<Card> cards = resolveCards(player, play.cardUids());
    Combo combo = Combo.resolve(cards);
    Combo prevTop = state.getTrick().getTopCombo();

    Set<String> uids = new LinkedHashSet<>(play.cardUids());
    setHand(player, player.getHand().stream().filter(c -> !uids.contains(c.uid())).toList());
    state.getTrick().getPlays().add(new TrickState.Play(player.getId(), combo));
    state.getTrick().setTopCombo(combo);
    state.getTrick().setTopOwner(player.getId());
    events.add(new GameEvent.Played(player.getId(), combo));

    if (player.getHand().isEmpty()) {
      player.setFinished(true);
      if (combo.cards().stream().anyMatch(c -> c.rank() == Rank.TWO)) {
        state.getBottomed().add(player.getId());
        events.add(new GameEvent.PlayerBottomed(player.getId()));
      } else {
        state.getFinishingOrder().add(player.getId());
        events.add(new GameEvent.PlayerFinished(player.getId(), state.getFinishingOrder().size()));
      }
    }

    if (prevTop != null && combo.isSingleTwo()) {
      endTrick(seat, events);
      checkRoundOver(events);
      return events;
    }

    if (prevTop != null && Combo.isSkip(prevTop, combo)) {
      List<Integer> ring = activeRingFrom(seat);
      List<Integer> others = ring.stream().filter(s -> s != seat).toList();
      if (combo.count() >= others.size()) {
        if (!others.isEmpty()) {
          events.add(new GameEvent.Skipped(others.stream().map(i -> state.getPlayers().get(i).getId()).toList()));
        }
        endTrick(seat, events);
        checkRoundOver(events);
        return events;
      }
      List<Integer> skipped = ring.subList(0, combo.count());
      events.add(new GameEvent.Skipped(skipped.stream().map(i -> state.getPlayers().get(i).getId()).toList()));
      int target = ring.get(combo.count() % ring.size());
      state.setTurn(target);
      events.add(new GameEvent.TurnChanged(state.getPlayers().get(target).getId()));
      checkRoundOver(events);
      return events;
    }

    advance(seat, events);
    checkRoundOver(events);
    return events;
  }

  /** Begin the next round: re-deal, mandatory takes, enter the exchange. */
  public List<GameEvent> beginExchange() {
    if (state.getPhase() != Phase.ROUND_OVER) {
      throw new IllegalStateException("the current round is not over");
    }
    List<GameEvent> events = new ArrayList<>();
    Rng rng = Rng.fromState(state.getRngState());
    List<List<Card>> hands = Deck.deal(state.getPlayers().size(), rng, state.getDecks());
    for (int i = 0; i < state.getPlayers().size(); i++) {
      PlayerState p = state.getPlayers().get(i);
      setHand(p, sortedHand(hands.get(i)));
      p.setPassed(false);
      p.setFinished(false);
    }
    state.setRngState(rng.state());

    mandatoryTakes();
    state.getPlayers().forEach(p -> setHand(p, sortedHand(p.getHand())));

    state.getTrick().setTopCombo(null);
    state.getTrick().setTopOwner(null);
    state.getTrick().getPlays().clear();
    state.getFinishingOrder().clear();
    state.getBottomed().clear();
    state.setStandings(null);
    state.setRound(state.getRound() + 1);

    state.getPendingExchanges().clear();
    PlayerState pres = byRole(Role.PRESIDENT);
    PlayerState vp = byRole(Role.VICE_PRESIDENT);
    PlayerState ass = byRole(Role.ASSHOLE);
    PlayerState vass = byRole(Role.VICE_ASSHOLE);
    if (pres != null && ass != null && !pres.getId().equals(ass.getId())) {
      state.getPendingExchanges().add(new ExchangeDebt(pres.getId(), ass.getId(), 2));
    }
    if (vp != null && vass != null && !vp.getId().equals(vass.getId())) {
      state.getPendingExchanges().add(new ExchangeDebt(vp.getId(), vass.getId(), 1));
    }

    if (state.getPendingExchanges().isEmpty()) {
      startPlay(events);
    } else {
      state.setPhase(Phase.EXCHANGE);
    }
    return events;
  }

  /** Resolve a player's chosen card uids to the Combo they'd form, or null. */
  public Combo comboOf(String playerId, List<String> uids) {
    PlayerState p = player(playerId);
    if (p == null) {
      return null;
    }
    List<Card> cards = resolveCards(p, uids);
    return cards != null ? Combo.resolve(cards) : null;
  }

  /**
   * Every legal play for the player on turn, one representative per rank+count.
   * Used by bots and to offer the human legal moves.
   */
  public List<Action> legalPlays(String playerId) {
    if (state.getPhase() != Phase.PLAYING
        || !state.getPlayers().get(state.getTurn()).getId().equals(playerId)) {
      return List.of();
    }
    List<Card> hand = state.getPlayers().get(state.getTurn()).getHand();
    List<Card> sevens = hand.stream().filter(c -> c.rank() == Rank.SEVEN).toList();
    Map<Rank, List<Card>> byRank = new LinkedHashMap<>();
    for (Card c : hand) {
      if (c.rank() == Rank.SEVEN) {
        continue;
      }
      byRank.computeIfAbsent(c.rank(), r -> new ArrayList<>()).add(c);
    }

    Combo top = state.getTrick().getTopCombo();
    int minRank = top != null ? top.rank().value() : -1;
    List<Action> plays = new ArrayList<>();

    if (top != null && top.count() > 1) {
      hand.stream().filter(c -> c.rank() == Rank.TWO).findFirst()
          .ifPresent(two -> plays.add(new Action.Play(playerId, List.of(two.uid()))));
    }

    for (Map.Entry<Rank, List<Card>> e : byRank.entrySet()) {
      emit(plays, playerId, e.getValue(), e.getKey().value(), sevens, top, minRank);
    }
    if (!sevens.isEmpty() && (top == null || Rank.SEVEN.value() >= minRank)) {
      List<Integer> counts = top != null
          ? (top.count() <= sevens.size() ? List.of(top.count()) : List.<Integer>of())
          : range(1, sevens.size());
      for (int k : counts) {
        plays.add(new Action.Play(playerId, uids(sevens.subList(0, k))));
      }
    }
    return plays;
  }

  private void emit(List<Action> plays, String playerId, List<Card> real, int rankValue,
                    List<Card> sevens, Combo top, int minRank) {
    if (top != null && rankValue < minRank) {
      return;
    }
    int maxWith = real.size() + sevens.size();
    List<Integer> counts = top != null
        ? (top.count() <= maxWith ? List.of(top.count()) : List.<Integer>of())
        : range(1, maxWith);
    for (int k : counts) {
      List<Card> useReal = real.subList(0, Math.min(real.size(), k));
      int need = k - useReal.size();
      if (!useReal.isEmpty() && need >= 0 && need <= sevens.size()) {
        List<Card> cards = new ArrayList<>(useReal);
        cards.addAll(sevens.subList(0, need));
        plays.add(new Action.Play(playerId, uids(cards)));
      }
    }
  }

  // --- internals -----------------------------------------------------------

  private List<GameEvent> applyExchange(Action.Exchange action) {
    List<GameEvent> events = new ArrayList<>();
    int idx = indexOfDebt(action.playerId());
    ExchangeDebt debt = state.getPendingExchanges().get(idx);
    PlayerState from = player(debt.from());
    PlayerState to = player(debt.to());
    List<Card> cards = resolveCards(from, action.cardUids());
    moveCards(from, to, cards);
    setHand(from, sortedHand(from.getHand()));
    setHand(to, sortedHand(to.getHand()));
    state.getPendingExchanges().remove(idx);
    events.add(new GameEvent.Exchanged(debt.from(), debt.to(), debt.count()));
    if (state.getPendingExchanges().isEmpty()) {
      startPlay(events);
    }
    return events;
  }

  private void mandatoryTakes() {
    PlayerState pres = byRole(Role.PRESIDENT);
    PlayerState vp = byRole(Role.VICE_PRESIDENT);
    PlayerState ass = byRole(Role.ASSHOLE);
    PlayerState vass = byRole(Role.VICE_ASSHOLE);
    if (pres != null && ass != null && !pres.getId().equals(ass.getId())) {
      moveCards(ass, pres, takeBest(ass, 2));
    }
    if (vp != null && vass != null && !vp.getId().equals(vass.getId())) {
      moveCards(vass, vp, takeBest(vass, 1));
    }
  }

  private void startPlay(List<GameEvent> events) {
    state.getPlayers().forEach(p -> setHand(p, sortedHand(p.getHand())));
    state.setPhase(Phase.PLAYING);
    PlayerState asshole = byRole(Role.ASSHOLE);
    state.setTurn(asshole != null ? asshole.getSeat() : 0);
    String leader = state.getPlayers().get(state.getTurn()).getId();
    events.add(new GameEvent.RoundStarted(state.getRound(), leader));
    events.add(new GameEvent.TurnChanged(leader));
  }

  private List<Card> resolveCards(PlayerState player, List<String> uids) {
    if (uids.isEmpty()) {
      return null;
    }
    List<Card> cards = new ArrayList<>();
    Set<String> seen = new LinkedHashSet<>();
    for (String uid : uids) {
      if (!seen.add(uid)) {
        return null;
      }
      Card card = player.getHand().stream().filter(c -> c.uid().equals(uid)).findFirst().orElse(null);
      if (card == null) {
        return null;
      }
      cards.add(card);
    }
    return cards;
  }

  /** Active (not passed, not finished) seats, cyclically ordered after {@code seat}. */
  private List<Integer> activeRingFrom(int seat) {
    List<Integer> active = new ArrayList<>();
    for (PlayerState p : state.getPlayers()) {
      if (!p.isPassed() && !p.isFinished()) {
        active.add(p.getSeat());
      }
    }
    active.sort(Integer::compareTo);
    if (active.isEmpty()) {
      return active;
    }
    int start = -1;
    for (int i = 0; i < active.size(); i++) {
      if (active.get(i) > seat) {
        start = i;
        break;
      }
    }
    if (start == -1) {
      start = 0;
    }
    List<Integer> ring = new ArrayList<>();
    for (int i = 0; i < active.size(); i++) {
      ring.add(active.get((start + i) % active.size()));
    }
    return ring;
  }

  private void advance(int fromSeat, List<GameEvent> events) {
    List<Integer> ring = activeRingFrom(fromSeat);
    if (ring.isEmpty()) {
      return;
    }
    state.setTurn(ring.get(0));
    events.add(new GameEvent.TurnChanged(state.getPlayers().get(ring.get(0)).getId()));
  }

  private void afterPass(int passerSeat, List<GameEvent> events) {
    List<Integer> ring = activeRingFrom(passerSeat);
    String topOwner = state.getTrick().getTopOwner();
    if (ring.isEmpty()) {
      if (topOwner != null) {
        endTrick(seatOf(topOwner), events);
        checkRoundOver(events);
      }
      return;
    }
    int next = ring.getFirst();
    if (state.getPlayers().get(next).getId().equals(topOwner)) {
      endTrick(next, events);
      checkRoundOver(events);
    } else {
      state.setTurn(next);
      events.add(new GameEvent.TurnChanged(state.getPlayers().get(next).getId()));
    }
  }

  private void endTrick(int winnerSeat, List<GameEvent> events) {
    events.add(new GameEvent.TrickWon(state.getPlayers().get(winnerSeat).getId()));
    state.getTrick().setTopCombo(null);
    state.getTrick().setTopOwner(null);
    state.getTrick().getPlays().clear();
    for (PlayerState p : state.getPlayers()) {
      if (!p.isFinished()) {
        p.setPassed(false);
      }
    }
    int lead = winnerSeat;
    if (state.getPlayers().get(winnerSeat).isFinished()) {
      lead = nextWithCardsFrom(winnerSeat);
    }
    if (lead >= 0) {
      state.setTurn(lead);
      events.add(new GameEvent.TurnChanged(state.getPlayers().get(lead).getId()));
    }
  }

  private int nextWithCardsFrom(int seat) {
    List<Integer> withCards = new ArrayList<>();
    for (PlayerState p : state.getPlayers()) {
      if (!p.isFinished()) {
        withCards.add(p.getSeat());
      }
    }
    withCards.sort(Integer::compareTo);
    if (withCards.isEmpty()) {
      return -1;
    }
    for (int s : withCards) {
      if (s > seat) {
        return s;
      }
    }
    return withCards.get(0);
  }

  private int seatOf(String playerId) {
    for (PlayerState p : state.getPlayers()) {
      if (p.getId().equals(playerId)) {
        return p.getSeat();
      }
    }
    return -1;
  }

  private void checkRoundOver(List<GameEvent> events) {
    if (state.getPhase() != Phase.PLAYING) {
      return;
    }
    List<PlayerState> withCards = state.getPlayers().stream().filter(p -> !p.isFinished()).toList();
    if (withCards.size() > 1) {
      return;
    }
    List<String> standings = new ArrayList<>(state.getFinishingOrder());
    if (withCards.size() == 1) {
      standings.add(withCards.get(0).getId());
    }
    standings.addAll(state.getBottomed());
    state.setStandings(standings);
    state.setPhase(Phase.ROUND_OVER);

    Map<String, Role> roles = assignRoles(standings);
    for (PlayerState p : state.getPlayers()) {
      p.setRole(roles.getOrDefault(p.getId(), Role.CITIZEN));
    }
    events.add(new GameEvent.RoundOver(standings, roles));
  }

  private static Map<String, Role> assignRoles(List<String> standings) {
    Map<String, Role> roles = new LinkedHashMap<>();
    int n = standings.size();
    for (String id : standings) {
      roles.put(id, Role.CITIZEN);
    }
    if (n >= 1) {
      roles.put(standings.get(0), Role.PRESIDENT);
    }
    if (n >= 2) {
      roles.put(standings.get(n - 1), Role.ASSHOLE);
    }
    if (n >= 4) {
      roles.put(standings.get(1), Role.VICE_PRESIDENT);
      roles.put(standings.get(n - 2), Role.VICE_ASSHOLE);
    }
    return roles;
  }

  /**
   * Game-one lead: the 3♣ holder, breaking a two-deck tie by whoever's hand is
   * lower comparing next-lowest cards by rank.
   */
  public static int firstLeaderSeat(List<PlayerState> players) {
    List<PlayerState> candidates = players.stream()
        .filter(p -> p.getHand().stream().anyMatch(c -> c.rank() == Rank.THREE && c.suit() == Suit.CLUBS))
        .toList();
    if (candidates.isEmpty()) {
      return 0;
    }
    PlayerState best = candidates.get(0);
    for (int i = 1; i < candidates.size(); i++) {
      if (compareHandsByRank(candidates.get(i).getHand(), best.getHand()) < 0) {
        best = candidates.get(i);
      }
    }
    return best.getSeat();
  }

  private static int compareHandsByRank(List<Card> a, List<Card> b) {
    List<Integer> ra = a.stream().map(c -> c.rank().value()).sorted().toList();
    List<Integer> rb = b.stream().map(c -> c.rank().value()).sorted().toList();
    int n = Math.min(ra.size(), rb.size());
    for (int i = 0; i < n; i++) {
      if (!ra.get(i).equals(rb.get(i))) {
        return ra.get(i) - rb.get(i);
      }
    }
    return ra.size() - rb.size();
  }

  private PlayerState player(String id) {
    return state.getPlayers().stream().filter(p -> p.getId().equals(id)).findFirst().orElse(null);
  }

  private PlayerState byRole(Role role) {
    return state.getPlayers().stream().filter(p -> p.getRole() == role).findFirst().orElse(null);
  }

  private ExchangeDebt findDebt(String fromId) {
    return state.getPendingExchanges().stream().filter(e -> e.from().equals(fromId)).findFirst().orElse(null);
  }

  private int indexOfDebt(String fromId) {
    List<ExchangeDebt> debts = state.getPendingExchanges();
    for (int i = 0; i < debts.size(); i++) {
      if (debts.get(i).from().equals(fromId)) {
        return i;
      }
    }
    return -1;
  }

  private static void setHand(PlayerState player, List<Card> cards) {
    player.getHand().clear();
    player.getHand().addAll(cards);
  }

  private static void moveCards(PlayerState from, PlayerState to, List<Card> cards) {
    Set<String> uids = new LinkedHashSet<>(uids(cards));
    setHand(from, from.getHand().stream().filter(c -> !uids.contains(c.uid())).toList());
    to.getHand().addAll(cards);
  }

  private static List<Card> takeBest(PlayerState player, int k) {
    List<Card> sorted = sortedHand(player.getHand());
    return new ArrayList<>(sorted.subList(sorted.size() - k, sorted.size()));
  }

  private static List<Card> sortedHand(List<Card> cards) {
    List<Card> copy = new ArrayList<>(cards);
    copy.sort(Card.ORDER);
    return copy;
  }

  private static List<String> uids(List<Card> cards) {
    return cards.stream().map(Card::uid).toList();
  }

  private static List<Integer> range(int lo, int hi) {
    List<Integer> out = new ArrayList<>();
    for (int i = lo; i <= hi; i++) {
      out.add(i);
    }
    return out;
  }

  /** Exposed for tests + bots that need to read state. */
  public Optional<PlayerState> playerById(String id) {
    return Optional.ofNullable(player(id));
  }
}
